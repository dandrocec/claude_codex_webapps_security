import hmac
import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from hashlib import sha256
from urllib.parse import urlparse

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
from flask_bcrypt import Bcrypt
from flask_wtf.csrf import CSRFProtect
from markupsafe import escape
from werkzeug.exceptions import HTTPException

try:
    import stripe
except ImportError:  # pragma: no cover - dependency is declared in requirements.txt
    stripe = None


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_URL", os.path.join(BASE_DIR, "shop.sqlite3"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48),
    WTF_CSRF_TIME_LIMIT=3600,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") == "1",
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=1024 * 1024,
    PAYMENT_WEBHOOK_SECRET=os.environ.get("PAYMENT_WEBHOOK_SECRET")
    or secrets.token_urlsafe(48),
    STRIPE_SECRET_KEY=os.environ.get("STRIPE_SECRET_KEY", ""),
    STRIPE_WEBHOOK_SECRET=os.environ.get("STRIPE_WEBHOOK_SECRET", ""),
)
bcrypt = Bcrypt(app)
csrf = CSRFProtect(app)

if stripe and app.config["STRIPE_SECRET_KEY"]:
    stripe.api_key = app.config["STRIPE_SECRET_KEY"]


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    cur = db.execute(sql, params)
    db.commit()
    return cur


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price_cents INTEGER NOT NULL CHECK(price_cents > 0),
            inventory INTEGER NOT NULL CHECK(inventory >= 0),
            is_active INTEGER NOT NULL DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('pending','paid','cancelled')),
            total_cents INTEGER NOT NULL CHECK(total_cents >= 0),
            provider TEXT NOT NULL,
            provider_session_id TEXT,
            created_at TEXT NOT NULL,
            paid_at TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK(quantity > 0),
            unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents > 0),
            FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY(product_id) REFERENCES products(id)
        );
        """
    )
    if not query_one("SELECT id FROM products LIMIT 1"):
        db.executemany(
            """
            INSERT INTO products (name, description, price_cents, inventory, is_active)
            VALUES (?, ?, ?, ?, 1)
            """,
            [
                ("Canvas Tote", "Heavy cotton tote for daily errands.", 2400, 40),
                ("Desk Lamp", "Adjustable warm LED task lamp.", 4999, 18),
                ("Notebook Set", "Three lay-flat notebooks with recycled paper.", 1800, 55),
                ("Travel Mug", "Leak-resistant insulated mug, 350 ml.", 3299, 24),
            ],
        )
    admin_email = os.environ.get("ADMIN_EMAIL")
    admin_password = os.environ.get("ADMIN_PASSWORD")
    if admin_email and admin_password and not query_one(
        "SELECT id FROM users WHERE email = ?", (admin_email.lower(),)
    ):
        password_hash = bcrypt.generate_password_hash(admin_password).decode("utf-8")
        db.execute(
            """
            INSERT INTO users (username, email, password_hash, is_admin, created_at)
            VALUES (?, ?, ?, 1, ?)
            """,
            ("admin", admin_email.lower(), password_hash, utc_now()),
        )
    db.commit()


@app.before_request
def load_user():
    init_db()
    g.user = None
    user_id = session.get("user_id")
    if user_id:
        g.user = query_one(
            "SELECT id, username, email, is_admin FROM users WHERE id = ?", (user_id,)
        )


@app.after_request
def security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Cache-Control"] = "no-store" if g.get("user") else "no-cache"
    return response


@app.errorhandler(Exception)
def handle_error(exc):
    if isinstance(exc, HTTPException):
        return render_template("error.html", code=exc.code, message=exc.description), exc.code
    return render_template("error.html", code=500, message="An unexpected error occurred."), 500


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            flash("Please sign in first.", "warning")
            return redirect(url_for("login", next=request.full_path))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def safe_redirect(target):
    if not target:
        return url_for("index")
    parsed = urlparse(target)
    if parsed.netloc or parsed.scheme:
        return url_for("index")
    return target


def cart_items():
    cart = session.get("cart", {})
    clean_cart = {}
    items = []
    total = 0
    for raw_id, raw_qty in cart.items():
        try:
            product_id = int(raw_id)
            quantity = max(1, min(int(raw_qty), 20))
        except (TypeError, ValueError):
            continue
        product = query_one(
            """
            SELECT id, name, description, price_cents, inventory
            FROM products
            WHERE id = ? AND is_active = 1
            """,
            (product_id,),
        )
        if not product:
            continue
        quantity = min(quantity, product["inventory"])
        if quantity <= 0:
            continue
        line_total = product["price_cents"] * quantity
        total += line_total
        clean_cart[str(product_id)] = quantity
        items.append({"product": product, "quantity": quantity, "line_total": line_total})
    session["cart"] = clean_cart
    return items, total


def money(cents):
    return f"${cents / 100:,.2f}"


app.jinja_env.filters["money"] = money


@app.route("/")
def index():
    products = query_all(
        """
        SELECT id, name, description, price_cents, inventory
        FROM products
        WHERE is_active = 1
        ORDER BY name
        """
    )
    return render_template("index.html", products=products)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not USERNAME_RE.fullmatch(username):
            flash("Username must be 3-32 letters, numbers, dots, underscores, or dashes.", "danger")
        elif not EMAIL_RE.fullmatch(email):
            flash("Enter a valid email address.", "danger")
        elif len(password) < 12:
            flash("Password must be at least 12 characters.", "danger")
        elif query_one("SELECT id FROM users WHERE username = ? OR email = ?", (username, email)):
            flash("That username or email is already registered.", "danger")
        else:
            password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
            execute(
                """
                INSERT INTO users (username, email, password_hash, is_admin, created_at)
                VALUES (?, ?, ?, 0, ?)
                """,
                (username, email, password_hash, utc_now()),
            )
            flash("Account created. Please sign in.", "success")
            return redirect(url_for("login"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = query_one("SELECT * FROM users WHERE email = ?", (email,))
        if user and bcrypt.check_password_hash(user["password_hash"], password):
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            return redirect(safe_redirect(request.args.get("next")))
        flash("Invalid email or password.", "danger")
    return render_template("login.html")


@app.post("/logout")
@login_required
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("index"))


@app.post("/cart/add/<int:product_id>")
def add_to_cart(product_id):
    product = query_one(
        "SELECT id, inventory FROM products WHERE id = ? AND is_active = 1", (product_id,)
    )
    if not product or product["inventory"] <= 0:
        abort(404)
    try:
        quantity = max(1, min(int(request.form.get("quantity", "1")), 20))
    except ValueError:
        quantity = 1
    cart = session.get("cart", {})
    current = int(cart.get(str(product_id), 0))
    cart[str(product_id)] = min(product["inventory"], current + quantity)
    session["cart"] = cart
    flash("Added to cart.", "success")
    return redirect(url_for("cart"))


@app.route("/cart", methods=["GET", "POST"])
def cart():
    if request.method == "POST":
        updated = {}
        for key, value in request.form.items():
            if not key.startswith("qty_"):
                continue
            try:
                product_id = int(key.removeprefix("qty_"))
                quantity = int(value)
            except ValueError:
                continue
            if quantity > 0:
                updated[str(product_id)] = min(quantity, 20)
        session["cart"] = updated
        flash("Cart updated.", "success")
        return redirect(url_for("cart"))
    items, total = cart_items()
    return render_template("cart.html", items=items, total=total)


@app.post("/checkout")
@login_required
def checkout():
    items, total = cart_items()
    if not items:
        flash("Your cart is empty.", "warning")
        return redirect(url_for("cart"))
    db = get_db()
    now = utc_now()
    cur = db.execute(
        """
        INSERT INTO orders (user_id, status, total_cents, provider, created_at)
        VALUES (?, 'pending', ?, ?, ?)
        """,
        (g.user["id"], total, "stripe" if app.config["STRIPE_SECRET_KEY"] else "sandbox", now),
    )
    order_id = cur.lastrowid
    for item in items:
        product = item["product"]
        db.execute(
            """
            INSERT INTO order_items
            (order_id, product_id, product_name, quantity, unit_price_cents)
            VALUES (?, ?, ?, ?, ?)
            """,
            (order_id, product["id"], product["name"], item["quantity"], product["price_cents"]),
        )
    db.commit()
    session["cart"] = {}
    if app.config["STRIPE_SECRET_KEY"]:
        return redirect(create_stripe_checkout(order_id, items))
    return redirect(url_for("sandbox_pay", order_id=order_id))


def create_stripe_checkout(order_id, items):
    if not stripe:
        abort(500)
    line_items = [
        {
            "price_data": {
                "currency": "usd",
                "product_data": {"name": item["product"]["name"]},
                "unit_amount": item["product"]["price_cents"],
            },
            "quantity": item["quantity"],
        }
        for item in items
    ]
    checkout_session = stripe.checkout.Session.create(
        mode="payment",
        line_items=line_items,
        metadata={"order_id": str(order_id)},
        success_url=url_for("order_detail", order_id=order_id, _external=True),
        cancel_url=url_for("cart", _external=True),
    )
    execute(
        "UPDATE orders SET provider_session_id = ? WHERE id = ? AND user_id = ?",
        (checkout_session.id, order_id, g.user["id"]),
    )
    return checkout_session.url


@app.route("/sandbox/pay/<int:order_id>", methods=["GET", "POST"])
@login_required
def sandbox_pay(order_id):
    order = query_one(
        "SELECT * FROM orders WHERE id = ? AND user_id = ? AND provider = 'sandbox'",
        (order_id, g.user["id"]),
    )
    if not order:
        abort(404)
    if request.method == "POST":
        payload = json.dumps({"event": "payment.succeeded", "order_id": order_id}).encode()
        signature = hmac.new(
            app.config["PAYMENT_WEBHOOK_SECRET"].encode(), payload, sha256
        ).hexdigest()
        process_payment_event(payload, signature)
        flash("Sandbox payment completed.", "success")
        return redirect(url_for("order_detail", order_id=order_id))
    return render_template("sandbox_pay.html", order=order)


@csrf.exempt
@app.post("/webhooks/payments")
def payment_webhook():
    payload = request.get_data(cache=False)
    if request.headers.get("Stripe-Signature") and app.config["STRIPE_WEBHOOK_SECRET"]:
        if not stripe:
            abort(400)
        try:
            event = stripe.Webhook.construct_event(
                payload,
                request.headers["Stripe-Signature"],
                app.config["STRIPE_WEBHOOK_SECRET"],
            )
        except Exception:
            abort(400)
        if event["type"] == "checkout.session.completed":
            order_id = int(event["data"]["object"]["metadata"]["order_id"])
            mark_order_paid(order_id, event["data"]["object"]["id"])
        return "", 204
    signature = request.headers.get("X-Sandbox-Signature", "")
    process_payment_event(payload, signature)
    return "", 204


def process_payment_event(payload, signature):
    expected = hmac.new(app.config["PAYMENT_WEBHOOK_SECRET"].encode(), payload, sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        abort(400)
    try:
        event = json.loads(payload.decode("utf-8"))
        order_id = int(event["order_id"])
    except (ValueError, KeyError, json.JSONDecodeError):
        abort(400)
    if event.get("event") == "payment.succeeded":
        mark_order_paid(order_id, "sandbox")


def mark_order_paid(order_id, provider_session_id):
    db = get_db()
    order = db.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not order or order["status"] == "paid":
        return
    items = db.execute(
        "SELECT product_id, quantity FROM order_items WHERE order_id = ?", (order_id,)
    ).fetchall()
    try:
        for item in items:
            updated = db.execute(
                """
                UPDATE products
                SET inventory = inventory - ?
                WHERE id = ? AND inventory >= ?
                """,
                (item["quantity"], item["product_id"], item["quantity"]),
            )
            if updated.rowcount != 1:
                raise ValueError("Insufficient inventory")
        db.execute(
            """
            UPDATE orders
            SET status = 'paid', paid_at = ?, provider_session_id = COALESCE(provider_session_id, ?)
            WHERE id = ?
            """,
            (utc_now(), provider_session_id, order_id),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise


@app.route("/orders")
@login_required
def orders():
    rows = query_all(
        """
        SELECT id, status, total_cents, provider, created_at, paid_at
        FROM orders
        WHERE user_id = ?
        ORDER BY created_at DESC
        """,
        (g.user["id"],),
    )
    return render_template("orders.html", orders=rows)


@app.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    order = query_one("SELECT * FROM orders WHERE id = ?", (order_id,))
    if not order:
        abort(404)
    if order["user_id"] != g.user["id"] and not g.user["is_admin"]:
        abort(403)
    items = query_all(
        """
        SELECT product_name, quantity, unit_price_cents
        FROM order_items
        WHERE order_id = ?
        ORDER BY id
        """,
        (order_id,),
    )
    return render_template("order_detail.html", order=order, items=items)


@app.route("/admin/orders")
@admin_required
def admin_orders():
    rows = query_all(
        """
        SELECT o.id, o.status, o.total_cents, o.provider, o.created_at, o.paid_at,
               u.username, u.email
        FROM orders o
        JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC
        """
    )
    return render_template("admin_orders.html", orders=rows)


@app.context_processor
def template_globals():
    items, total = cart_items()
    return {"cart_count": sum(item["quantity"] for item in items), "cart_total": total, "escape": escape}


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5089")), debug=False)
