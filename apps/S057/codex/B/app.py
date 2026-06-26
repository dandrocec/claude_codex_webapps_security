import html
import os
import secrets
import sqlite3
from decimal import Decimal, InvalidOperation
from functools import wraps

import bcrypt
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
from markupsafe import Markup
from werkzeug.exceptions import HTTPException


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_URL", os.path.join(BASE_DIR, "shop.db"))


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY must be set in the environment.")

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=3600,
        MAX_CONTENT_LENGTH=1024 * 1024,
    )

    register_security_headers(app)
    register_error_handlers(app)
    register_routes(app)

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
            description TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )

    count = db.execute("SELECT COUNT(*) AS total FROM products").fetchone()["total"]
    if count == 0:
        db.executemany(
            "INSERT INTO products (name, price_cents, description) VALUES (?, ?, ?)",
            [
                ("Canvas Daypack", 4999, "A durable everyday backpack with padded laptop storage."),
                ("Ceramic Mug", 1599, "A dishwasher-safe mug with a comfortable hand-thrown shape."),
                ("Desk Lamp", 6499, "A dimmable LED lamp with warm and cool light settings."),
                ("Linen Notebook", 1299, "A lay-flat notebook with recycled paper and a linen cover."),
            ],
        )
        db.commit()


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def register_security_headers(app):
    @app.after_request
    def add_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "style-src 'self'; "
            "script-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    app.teardown_appcontext(close_db)


def register_error_handlers(app):
    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            return render_template("error.html", code=error.code, message=error.description), error.code
        return render_template("error.html", code=500, message="An unexpected error occurred."), 500


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            flash("Please sign in first.")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT id, username FROM users WHERE id = ?", (user_id,)).fetchone()


def generate_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf():
    supplied = request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if not expected or not secrets.compare_digest(supplied, expected):
        abort(400, "Invalid CSRF token.")


def clean_text(value, min_length, max_length):
    value = " ".join((value or "").strip().split())
    if len(value) < min_length or len(value) > max_length:
        return None
    return value


def money(cents):
    return f"${Decimal(cents) / Decimal(100):,.2f}"


def nl2br(value):
    escaped = html.escape(value or "")
    return Markup(escaped.replace("\n", "<br>"))


def cart_items():
    raw_cart = session.get("cart", {})
    clean_cart = {}
    for key, quantity in raw_cart.items():
        try:
            product_id = int(key)
            quantity = int(quantity)
        except (TypeError, ValueError):
            continue
        if product_id > 0 and 0 < quantity <= 99:
            clean_cart[str(product_id)] = quantity

    session["cart"] = clean_cart
    if not clean_cart:
        return [], 0

    placeholders = ",".join("?" for _ in clean_cart)
    products = get_db().execute(
        f"SELECT id, name, price_cents FROM products WHERE id IN ({placeholders})",
        tuple(int(product_id) for product_id in clean_cart.keys()),
    ).fetchall()

    items = []
    total = 0
    for product in products:
        quantity = clean_cart[str(product["id"])]
        line_total = product["price_cents"] * quantity
        total += line_total
        items.append({"product": product, "quantity": quantity, "line_total": line_total})
    return items, total


def register_routes(app):
    app.jinja_env.globals["csrf_token"] = generate_csrf_token
    app.jinja_env.globals["current_user"] = current_user
    app.jinja_env.filters["money"] = money
    app.jinja_env.filters["nl2br"] = nl2br

    @app.before_request
    def protect_state_changes():
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            validate_csrf()

    @app.route("/")
    def index():
        products = get_db().execute(
            "SELECT id, name, price_cents, description FROM products ORDER BY name"
        ).fetchall()
        return render_template("catalog.html", products=products)

    @app.route("/products/<int:product_id>")
    def product_detail(product_id):
        product = get_db().execute(
            "SELECT id, name, price_cents, description FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if not product:
            abort(404, "Product not found.")

        comments = get_db().execute(
            """
            SELECT comments.id, comments.body, comments.created_at, comments.user_id, users.username
            FROM comments
            JOIN users ON users.id = comments.user_id
            WHERE comments.product_id = ?
            ORDER BY comments.created_at DESC, comments.id DESC
            """,
            (product_id,),
        ).fetchall()
        return render_template("product.html", product=product, comments=comments)

    @app.route("/products/<int:product_id>/comments", methods=["POST"])
    @login_required
    def add_comment(product_id):
        product = get_db().execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
        if not product:
            abort(404, "Product not found.")

        body = request.form.get("body", "").strip()
        if len(body) < 2 or len(body) > 800:
            flash("Comments must be between 2 and 800 characters.")
            return redirect(url_for("product_detail", product_id=product_id))

        get_db().execute(
            "INSERT INTO comments (product_id, user_id, body) VALUES (?, ?, ?)",
            (product_id, session["user_id"], body),
        )
        get_db().commit()
        flash("Comment posted.")
        return redirect(url_for("product_detail", product_id=product_id))

    @app.route("/comments/<int:comment_id>/delete", methods=["POST"])
    @login_required
    def delete_comment(comment_id):
        comment = get_db().execute(
            "SELECT id, product_id, user_id FROM comments WHERE id = ?",
            (comment_id,),
        ).fetchone()
        if not comment:
            abort(404, "Comment not found.")
        if comment["user_id"] != session["user_id"]:
            abort(403, "You cannot modify another user's comment.")

        get_db().execute("DELETE FROM comments WHERE id = ? AND user_id = ?", (comment_id, session["user_id"]))
        get_db().commit()
        flash("Comment deleted.")
        return redirect(url_for("product_detail", product_id=comment["product_id"]))

    @app.route("/cart")
    def cart():
        items, total = cart_items()
        return render_template("cart.html", items=items, total=total)

    @app.route("/cart/add/<int:product_id>", methods=["POST"])
    def add_to_cart(product_id):
        product = get_db().execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
        if not product:
            abort(404, "Product not found.")

        try:
            quantity = int(request.form.get("quantity", "1"))
        except ValueError:
            quantity = 1
        quantity = min(max(quantity, 1), 20)

        cart = session.get("cart", {})
        key = str(product_id)
        cart[key] = min(int(cart.get(key, 0)) + quantity, 99)
        session["cart"] = cart
        flash("Item added to cart.")
        return redirect(request.referrer if request.referrer and request.referrer.startswith(request.host_url) else url_for("cart"))

    @app.route("/cart/update/<int:product_id>", methods=["POST"])
    def update_cart(product_id):
        cart = session.get("cart", {})
        key = str(product_id)
        try:
            quantity = int(request.form.get("quantity", "0"))
        except ValueError:
            quantity = 0

        if quantity <= 0:
            cart.pop(key, None)
        elif quantity <= 99:
            product = get_db().execute("SELECT id FROM products WHERE id = ?", (product_id,)).fetchone()
            if not product:
                abort(404, "Product not found.")
            cart[key] = quantity
        else:
            flash("Quantity must be 99 or less.")

        session["cart"] = cart
        return redirect(url_for("cart"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = clean_text(request.form.get("username"), 3, 32)
            password = request.form.get("password", "")
            if not username or not username.replace("_", "").isalnum():
                flash("Use 3-32 letters, numbers, or underscores for the username.")
                return redirect(url_for("register"))
            if len(password) < 12 or len(password) > 128:
                flash("Password must be between 12 and 128 characters.")
                return redirect(url_for("register"))

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
            try:
                get_db().execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, password_hash),
                )
                get_db().commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.")
                return redirect(url_for("register"))

            flash("Account created. Please sign in.")
            return redirect(url_for("login"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_text(request.form.get("username"), 3, 32)
            password = request.form.get("password", "")
            user = None
            if username:
                user = get_db().execute(
                    "SELECT id, username, password_hash FROM users WHERE username = ?",
                    (username,),
                ).fetchone()

            if not user or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"]):
                flash("Invalid username or password.")
                return redirect(url_for("login"))

            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            flash("Signed in.")
            next_url = request.args.get("next")
            return redirect(next_url if next_url and next_url.startswith("/") and not next_url.startswith("//") else url_for("index"))

        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("Signed out.")
        return redirect(url_for("index"))


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5057"))
    app.run(host="127.0.0.1", port=port, ssl_context="adhoc")
