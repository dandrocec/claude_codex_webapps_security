"""A small but security-conscious online shop.

Features
--------
* Catalogue of products (name, price, description) stored in a database.
* A product page where logged-in visitors can post comments that are stored
  and displayed.
* A session-based shopping cart with a running total.
* User registration / login with Argon2 password hashing.

Security notes are inline throughout, mapped to the relevant OWASP Top 10
categories. Highlights:

* A03 Injection .............. all SQL uses parameterised queries (see db.py).
* A07 Auth failures ......... Argon2id password hashing, generic login errors.
* A01 Access control ........ comment deletion is owner-checked (anti-IDOR).
* XSS ....................... Jinja2 autoescaping + input validation.
* CSRF ...................... Flask-WTF CSRFProtect on every POST.
* A05 Misconfiguration ...... secure cookies + security response headers.
* A09/A04 .................. no stack traces leaked; secrets from env only.
"""

import os
import re

from dotenv import load_dotenv
from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

import db

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

app = Flask(__name__)

# Secrets must come from the environment; never hardcode them (A02/A05).
# We refuse to start with a weak default in production-like settings.
secret_key = os.environ.get("SECRET_KEY")
if not secret_key:
    if os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError("SECRET_KEY environment variable is required")
    # Ephemeral key for local development only. Sessions reset on restart.
    secret_key = os.urandom(32)
app.config["SECRET_KEY"] = secret_key

# Secure session cookie configuration.
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,   # not readable by JavaScript (XSS mitigation)
    SESSION_COOKIE_SAMESITE="Lax",  # CSRF mitigation for top-level navigation
    # Secure flag requires HTTPS. Default off for local HTTP dev; set
    # SESSION_COOKIE_SECURE=1 in any environment served over TLS.
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "0") == "1",
)

# CSRF protection for all state-changing (POST) requests.
csrf = CSRFProtect(app)

# Argon2id password hasher with library-recommended defaults.
password_hasher = PasswordHasher()

# Input validation rules.
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
MIN_PASSWORD_LEN = 8
MAX_COMMENT_LEN = 1000
MAX_QTY_PER_ITEM = 99


# ---------------------------------------------------------------------------
# Request lifecycle helpers
# ---------------------------------------------------------------------------

@app.before_request
def load_current_user():
    """Attach the logged-in user (if any) to ``g`` for the request."""
    g.user = None
    user_id = session.get("user_id")
    if user_id is not None:
        g.user = db.query_one(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        )


@app.after_request
def set_security_headers(response):
    """Apply baseline security response headers (A05)."""
    # A strict, self-only Content-Security-Policy. Inline styles are disallowed;
    # all CSS is served from our own static file.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; "
        "style-src 'self'; script-src 'self'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


@app.context_processor
def inject_globals():
    """Expose cart item count to all templates."""
    cart = session.get("cart", {})
    return {"cart_count": sum(cart.values())}


# ---------------------------------------------------------------------------
# Domain helpers
# ---------------------------------------------------------------------------

def money(cents):
    """Format integer cents as a currency string for display."""
    return f"${cents / 100:,.2f}"


# Make the formatter available inside templates.
app.jinja_env.filters["money"] = money


def login_required(view):
    """Decorator that redirects anonymous users to the login page."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def get_cart_items():
    """Resolve the session cart into product rows + line/grand totals.

    Prices are always read fresh from the database, never from the session,
    so a tampered cookie cannot alter pricing.
    """
    cart = session.get("cart", {})
    items = []
    total_cents = 0
    for product_id, qty in cart.items():
        product = db.query_one(
            "SELECT id, name, price_cents FROM products WHERE id = ?",
            (product_id,),
        )
        if product is None:
            continue  # product was removed; skip silently
        line_cents = product["price_cents"] * qty
        total_cents += line_cents
        items.append(
            {
                "id": product["id"],
                "name": product["name"],
                "price_cents": product["price_cents"],
                "qty": qty,
                "line_cents": line_cents,
            }
        )
    return items, total_cents


# ---------------------------------------------------------------------------
# Catalogue & product pages
# ---------------------------------------------------------------------------

@app.route("/")
def catalogue():
    products = db.query_all(
        "SELECT id, name, price_cents, description FROM products ORDER BY name"
    )
    return render_template("catalogue.html", products=products)


@app.route("/product/<int:product_id>")
def product(product_id):
    product_row = db.query_one(
        "SELECT id, name, price_cents, description FROM products WHERE id = ?",
        (product_id,),
    )
    if product_row is None:
        abort(404)
    comments = db.query_all(
        """
        SELECT c.id, c.body, c.created_at, c.user_id, u.username
          FROM comments c
          JOIN users u ON u.id = c.user_id
         WHERE c.product_id = ?
         ORDER BY c.created_at DESC, c.id DESC
        """,
        (product_id,),
    )
    return render_template("product.html", product=product_row, comments=comments)


@app.route("/product/<int:product_id>/comment", methods=["POST"])
@login_required
def add_comment(product_id):
    # Ensure the product exists before accepting a comment.
    product_row = db.query_one("SELECT id FROM products WHERE id = ?", (product_id,))
    if product_row is None:
        abort(404)

    # Validate & normalise input (XSS defence is layered: validate here,
    # output-encode in the template via autoescaping).
    body = (request.form.get("body") or "").strip()
    if not body:
        flash("Comment cannot be empty.")
    elif len(body) > MAX_COMMENT_LEN:
        flash(f"Comment is too long (max {MAX_COMMENT_LEN} characters).")
    else:
        db.execute(
            "INSERT INTO comments (product_id, user_id, body) VALUES (?, ?, ?)",
            (product_id, g.user["id"], body),
        )
        flash("Comment posted.")
    return redirect(url_for("product", product_id=product_id))


@app.route("/comment/<int:comment_id>/delete", methods=["POST"])
@login_required
def delete_comment(comment_id):
    comment = db.query_one(
        "SELECT id, product_id, user_id FROM comments WHERE id = ?", (comment_id,)
    )
    if comment is None:
        abort(404)
    # Access control / anti-IDOR (A01): only the author may delete a comment.
    if comment["user_id"] != g.user["id"]:
        abort(403)
    db.execute("DELETE FROM comments WHERE id = ?", (comment_id,))
    flash("Comment deleted.")
    return redirect(url_for("product", product_id=comment["product_id"]))


# ---------------------------------------------------------------------------
# Shopping cart (held in the session)
# ---------------------------------------------------------------------------

@app.route("/cart")
def cart():
    items, total_cents = get_cart_items()
    return render_template("cart.html", items=items, total_cents=total_cents)


@app.route("/cart/add/<int:product_id>", methods=["POST"])
def cart_add(product_id):
    product_row = db.query_one("SELECT id FROM products WHERE id = ?", (product_id,))
    if product_row is None:
        abort(404)

    # Validate quantity: positive integer within a sane bound.
    try:
        qty = int(request.form.get("qty", "1"))
    except (TypeError, ValueError):
        qty = 1
    qty = max(1, min(qty, MAX_QTY_PER_ITEM))

    cart_data = session.get("cart", {})
    # Session keys are strings once serialised; keep them consistent.
    key = str(product_id)
    new_qty = min(cart_data.get(key, 0) + qty, MAX_QTY_PER_ITEM)
    cart_data[key] = new_qty
    session["cart"] = cart_data
    flash("Added to cart.")
    return redirect(url_for("cart"))


@app.route("/cart/remove/<int:product_id>", methods=["POST"])
def cart_remove(product_id):
    cart_data = session.get("cart", {})
    cart_data.pop(str(product_id), None)
    session["cart"] = cart_data
    flash("Removed from cart.")
    return redirect(url_for("cart"))


@app.route("/cart/clear", methods=["POST"])
def cart_clear():
    session.pop("cart", None)
    flash("Cart cleared.")
    return redirect(url_for("cart"))


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------

@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user is not None:
        return redirect(url_for("catalogue"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if not USERNAME_RE.match(username):
            flash("Username must be 3-32 chars: letters, numbers, underscore.")
        elif len(password) < MIN_PASSWORD_LEN:
            flash(f"Password must be at least {MIN_PASSWORD_LEN} characters.")
        elif db.query_one("SELECT id FROM users WHERE username = ?", (username,)):
            flash("That username is already taken.")
        else:
            # Argon2id hashing with a per-password random salt (handled by the
            # library). The plaintext password is never stored.
            pw_hash = password_hasher.hash(password)
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, pw_hash),
            )
            flash("Account created. Please log in.")
            return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user is not None:
        return redirect(url_for("catalogue"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = db.query_one(
            "SELECT id, password_hash FROM users WHERE username = ?", (username,)
        )

        # Use a generic message so we don't reveal whether the username exists.
        authenticated = False
        if user is not None:
            try:
                password_hasher.verify(user["password_hash"], password)
                authenticated = True
                # Transparently upgrade the hash if parameters have changed.
                if password_hasher.check_needs_rehash(user["password_hash"]):
                    db.execute(
                        "UPDATE users SET password_hash = ? WHERE id = ?",
                        (password_hasher.hash(password), user["id"]),
                    )
            except VerifyMismatchError:
                authenticated = False

        if authenticated:
            # Prevent session fixation: clear any prior session state, keeping
            # the cart, then bind the new identity.
            cart_data = session.get("cart")
            session.clear()
            if cart_data:
                session["cart"] = cart_data
            session["user_id"] = user["id"]
            flash("Logged in.")
            # Only honour same-site relative redirect targets (open-redirect safe).
            nxt = request.args.get("next", "")
            if nxt.startswith("/") and not nxt.startswith("//"):
                return redirect(nxt)
            return redirect(url_for("catalogue"))

        flash("Invalid username or password.")

    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("Logged out.")
    return redirect(url_for("catalogue"))


# ---------------------------------------------------------------------------
# Error handling — never leak internals to the client (A09).
# ---------------------------------------------------------------------------

@app.errorhandler(CSRFError)
def handle_csrf_error(error):
    return render_template("error.html", code=400, message="Invalid or missing CSRF token."), 400


@app.errorhandler(403)
def handle_403(error):
    return render_template("error.html", code=403, message="You are not allowed to do that."), 403


@app.errorhandler(404)
def handle_404(error):
    return render_template("error.html", code=404, message="Page not found."), 404


@app.errorhandler(500)
def handle_500(error):
    # The real exception is logged by Flask; the client sees a generic message.
    return render_template("error.html", code=500, message="Something went wrong."), 500


if __name__ == "__main__":
    db.init_db()
    port = int(os.environ.get("PORT", "5057"))
    # debug must stay False so tracebacks are never exposed to clients.
    app.run(host="127.0.0.1", port=port, debug=False)
