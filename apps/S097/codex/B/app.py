import os
import re
import secrets
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
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
from werkzeug.exceptions import HTTPException


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "shop.db"))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
STATUSES = {"pending", "paid", "shipped", "cancelled"}

app = Flask(__name__)
secret = os.environ.get("FLASK_SECRET_KEY")
if not secret:
    raise RuntimeError("FLASK_SECRET_KEY environment variable is required")
app.config.update(
    SECRET_KEY=secret,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") == "1",
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=1024 * 1024,
)


def db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def query_one(sql, params=()):
    return db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return db().execute(sql, params).fetchall()


def money(cents):
    return f"${Decimal(cents or 0) / Decimal(100):,.2f}"


app.jinja_env.filters["money"] = money


def clean_text(value, min_len=0, max_len=255, field="value"):
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "").strip()
    if len(value) < min_len or len(value) > max_len:
        raise ValueError(f"{field} must be between {min_len} and {max_len} characters.")
    return value


def parse_cents(value):
    try:
        amount = Decimal((value or "").strip()).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except Exception as exc:
        raise ValueError("Price must be a valid decimal amount.") from exc
    if amount < 0 or amount > Decimal("999999.99"):
        raise ValueError("Price is out of range.")
    return int(amount * 100)


def parse_int(value, field, min_value=0, max_value=100000):
    try:
        parsed = int(value)
    except Exception as exc:
        raise ValueError(f"{field} must be a number.") from exc
    if parsed < min_value or parsed > max_value:
        raise ValueError(f"{field} is out of range.")
    return parsed


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")


def verify_password(password, hashed):
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    return query_one("SELECT id, email, name, is_admin FROM users WHERE id = ?", (uid,))


@app.before_request
def load_user_and_protect_csrf():
    g.user = current_user()
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        expected = session.get("csrf_token")
        supplied = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
        if not expected or not supplied or not secrets.compare_digest(expected, supplied):
            abort(400)


@app.context_processor
def globals_for_templates():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    count = 0
    if g.get("user"):
        row = query_one("SELECT COALESCE(SUM(quantity), 0) AS c FROM cart_items WHERE user_id = ?", (g.user["id"],))
        count = row["c"]
    return {"csrf_token": session["csrf_token"], "cart_count": count, "user": g.get("user")}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            flash("Please sign in first.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user or not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapped


@app.after_request
def security_headers(resp):
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    )
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return resp


def init_db():
    schema = """
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
        inventory INTEGER NOT NULL CHECK(inventory >= 0),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cart_items (
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        PRIMARY KEY (user_id, product_id),
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        total_cents INTEGER NOT NULL,
        shipping_name TEXT NOT NULL,
        shipping_address TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        product_name TEXT NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        line_total_cents INTEGER NOT NULL,
        FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(product_id, user_id),
        FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    """
    with closing(sqlite3.connect(DB_PATH)) as conn:
        conn.executescript(schema)
        now = datetime.now(timezone.utc).isoformat()
        if conn.execute("SELECT COUNT(*) FROM products").fetchone()[0] == 0:
            conn.executemany(
                "INSERT INTO products (name, description, price_cents, inventory, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
                [
                    ("Canvas Tote", "Durable everyday tote with reinforced handles.", 2499, 25, now),
                    ("Desk Lamp", "Adjustable warm-light lamp for focused work.", 4599, 12, now),
                    ("Ceramic Mug", "Dishwasher-safe mug with a matte glaze.", 1599, 40, now),
                ],
            )
        admin_email = os.environ.get("ADMIN_EMAIL", "").strip().lower()
        admin_password = os.environ.get("ADMIN_PASSWORD", "")
        if admin_email and admin_password and not conn.execute("SELECT 1 FROM users WHERE email = ?", (admin_email,)).fetchone():
            conn.execute(
                "INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 1, ?)",
                (admin_email, "Admin", hash_password(admin_password), now),
            )
        conn.commit()


@app.route("/")
def index():
    products = query_all(
        "SELECT p.*, COALESCE(AVG(r.rating), 0) AS avg_rating, COUNT(r.id) AS review_count "
        "FROM products p LEFT JOIN reviews r ON r.product_id = p.id "
        "WHERE p.active = 1 GROUP BY p.id ORDER BY p.created_at DESC"
    )
    return render_template("index.html", products=products)


@app.route("/products/<int:product_id>")
def product_detail(product_id):
    product = query_one("SELECT * FROM products WHERE id = ? AND active = 1", (product_id,))
    if not product:
        abort(404)
    reviews = query_all(
        "SELECT r.*, u.name FROM reviews r JOIN users u ON u.id = r.user_id "
        "WHERE r.product_id = ? ORDER BY r.created_at DESC",
        (product_id,),
    )
    return render_template("product.html", product=product, reviews=reviews)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        try:
            name = clean_text(request.form.get("name"), 2, 80, "Name")
            email = clean_text(request.form.get("email"), 5, 254, "Email").lower()
            password = request.form.get("password") or ""
            if not EMAIL_RE.match(email):
                raise ValueError("Enter a valid email address.")
            if len(password) < 12:
                raise ValueError("Password must be at least 12 characters.")
            conn = db()
            cur = conn.execute(
                "INSERT INTO users (email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, 0, ?)",
                (email, name, hash_password(password), datetime.now(timezone.utc).isoformat()),
            )
            conn.commit()
            session.clear()
            session["user_id"] = cur.lastrowid
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("index"))
        except sqlite3.IntegrityError:
            flash("An account with that email already exists.", "error")
        except ValueError as exc:
            flash(str(exc), "error")
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = (request.form.get("email") or "").strip().lower()
        password = request.form.get("password") or ""
        user = query_one("SELECT * FROM users WHERE email = ?", (email,))
        if user and verify_password(password, user["password_hash"]):
            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            next_url = request.args.get("next")
            return redirect(next_url if next_url and next_url.startswith("/") and not next_url.startswith("//") else url_for("index"))
        flash("Invalid email or password.", "error")
    return render_template("login.html")


@app.post("/logout")
@login_required
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.post("/cart/add/<int:product_id>")
@login_required
def add_to_cart(product_id):
    try:
        qty = parse_int(request.form.get("quantity", "1"), "Quantity", 1, 99)
        product = query_one("SELECT id, inventory FROM products WHERE id = ? AND active = 1", (product_id,))
        if not product:
            abort(404)
        qty = min(qty, product["inventory"])
        if qty < 1:
            flash("That product is out of stock.", "warning")
            return redirect(url_for("product_detail", product_id=product_id))
        db().execute(
            "INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) "
            "ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = MIN(quantity + excluded.quantity, ?)",
            (g.user["id"], product_id, qty, product["inventory"]),
        )
        db().commit()
        flash("Added to cart.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("cart"))


@app.route("/cart", methods=["GET", "POST"])
@login_required
def cart():
    if request.method == "POST":
        for key, value in request.form.items():
            if key.startswith("qty_"):
                product_id = parse_int(key[4:], "Product", 1)
                qty = parse_int(value, "Quantity", 0, 99)
                product = query_one("SELECT inventory FROM products WHERE id = ? AND active = 1", (product_id,))
                if not product or qty == 0:
                    db().execute("DELETE FROM cart_items WHERE user_id = ? AND product_id = ?", (g.user["id"], product_id))
                else:
                    db().execute(
                        "UPDATE cart_items SET quantity = ? WHERE user_id = ? AND product_id = ?",
                        (min(qty, product["inventory"]), g.user["id"], product_id),
                    )
        db().commit()
        return redirect(url_for("cart"))
    items = query_all(
        "SELECT c.quantity, p.id, p.name, p.price_cents, p.inventory, p.active, "
        "(c.quantity * p.price_cents) AS line_total "
        "FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ? ORDER BY p.name",
        (g.user["id"],),
    )
    total = sum(row["line_total"] for row in items if row["active"])
    return render_template("cart.html", items=items, total=total)


@app.route("/checkout", methods=["GET", "POST"])
@login_required
def checkout():
    items = query_all(
        "SELECT c.product_id, c.quantity, p.name, p.price_cents, p.inventory, p.active "
        "FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?",
        (g.user["id"],),
    )
    available = [i for i in items if i["active"] and i["quantity"] <= i["inventory"] and i["inventory"] > 0]
    total = sum(i["quantity"] * i["price_cents"] for i in available)
    if request.method == "POST":
        if not available:
            flash("Your cart has no available items.", "warning")
            return redirect(url_for("cart"))
        try:
            shipping_name = clean_text(request.form.get("shipping_name"), 2, 100, "Shipping name")
            shipping_address = clean_text(request.form.get("shipping_address"), 10, 500, "Shipping address")
            conn = db()
            conn.execute("BEGIN IMMEDIATE")
            locked_items = conn.execute(
                "SELECT c.product_id, c.quantity, p.name, p.price_cents, p.inventory, p.active "
                "FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ?",
                (g.user["id"],),
            ).fetchall()
            purchasable = []
            for item in locked_items:
                if item["active"] and item["inventory"] >= item["quantity"] and item["quantity"] > 0:
                    purchasable.append(item)
            if not purchasable:
                raise ValueError("No cart items are currently available.")
            total = sum(i["quantity"] * i["price_cents"] for i in purchasable)
            cur = conn.execute(
                "INSERT INTO orders (user_id, status, total_cents, shipping_name, shipping_address, created_at) "
                "VALUES (?, 'paid', ?, ?, ?, ?)",
                (g.user["id"], total, shipping_name, shipping_address, datetime.now(timezone.utc).isoformat()),
            )
            order_id = cur.lastrowid
            for item in purchasable:
                line_total = item["quantity"] * item["price_cents"]
                conn.execute(
                    "INSERT INTO order_items (order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (order_id, item["product_id"], item["name"], item["price_cents"], item["quantity"], line_total),
                )
                conn.execute(
                    "UPDATE products SET inventory = inventory - ? WHERE id = ? AND inventory >= ?",
                    (item["quantity"], item["product_id"], item["quantity"]),
                )
            conn.execute("DELETE FROM cart_items WHERE user_id = ?", (g.user["id"],))
            conn.commit()
            return redirect(url_for("order_detail", order_id=order_id))
        except ValueError as exc:
            db().rollback()
            flash(str(exc), "error")
    return render_template("checkout.html", items=available, total=total)


@app.route("/orders")
@login_required
def orders():
    rows = query_all("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", (g.user["id"],))
    return render_template("orders.html", orders=rows)


@app.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    order = query_one("SELECT * FROM orders WHERE id = ? AND user_id = ?", (order_id, g.user["id"]))
    if not order:
        abort(404)
    items = query_all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,))
    return render_template("order_detail.html", order=order, items=items)


@app.post("/products/<int:product_id>/reviews")
@login_required
def add_review(product_id):
    product = query_one("SELECT id FROM products WHERE id = ? AND active = 1", (product_id,))
    if not product:
        abort(404)
    purchased = query_one(
        "SELECT 1 FROM orders o JOIN order_items i ON i.order_id = o.id "
        "WHERE o.user_id = ? AND i.product_id = ? AND o.status IN ('paid', 'shipped')",
        (g.user["id"], product_id),
    )
    if not purchased:
        abort(403)
    try:
        rating = parse_int(request.form.get("rating"), "Rating", 1, 5)
        body = clean_text(request.form.get("body"), 5, 1000, "Review")
        db().execute(
            "INSERT INTO reviews (product_id, user_id, rating, body, created_at) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(product_id, user_id) DO UPDATE SET rating = excluded.rating, body = excluded.body, created_at = excluded.created_at",
            (product_id, g.user["id"], rating, body, datetime.now(timezone.utc).isoformat()),
        )
        db().commit()
        flash("Review saved.", "success")
    except ValueError as exc:
        flash(str(exc), "error")
    return redirect(url_for("product_detail", product_id=product_id))


@app.route("/admin")
@admin_required
def admin_dashboard():
    stats = {
        "products": query_one("SELECT COUNT(*) AS c FROM products")["c"],
        "orders": query_one("SELECT COUNT(*) AS c FROM orders")["c"],
        "revenue": query_one("SELECT COALESCE(SUM(total_cents), 0) AS c FROM orders WHERE status != 'cancelled'")["c"],
    }
    recent_orders = query_all(
        "SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC LIMIT 10"
    )
    return render_template("admin/dashboard.html", stats=stats, orders=recent_orders)


@app.route("/admin/products")
@admin_required
def admin_products():
    products = query_all("SELECT * FROM products ORDER BY id DESC")
    return render_template("admin/products.html", products=products)


@app.route("/admin/products/new", methods=["GET", "POST"])
@admin_required
def admin_product_new():
    if request.method == "POST":
        try:
            data = product_form_data()
            db().execute(
                "INSERT INTO products (name, description, price_cents, inventory, active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
                (*data, datetime.now(timezone.utc).isoformat()),
            )
            db().commit()
            return redirect(url_for("admin_products"))
        except ValueError as exc:
            flash(str(exc), "error")
    return render_template("admin/product_form.html", product=None)


@app.route("/admin/products/<int:product_id>/edit", methods=["GET", "POST"])
@admin_required
def admin_product_edit(product_id):
    product = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if not product:
        abort(404)
    if request.method == "POST":
        try:
            data = product_form_data()
            db().execute(
                "UPDATE products SET name = ?, description = ?, price_cents = ?, inventory = ?, active = ? WHERE id = ?",
                (*data, product_id),
            )
            db().commit()
            return redirect(url_for("admin_products"))
        except ValueError as exc:
            flash(str(exc), "error")
    return render_template("admin/product_form.html", product=product)


def product_form_data():
    name = clean_text(request.form.get("name"), 2, 120, "Product name")
    description = clean_text(request.form.get("description"), 5, 1000, "Description")
    price_cents = parse_cents(request.form.get("price"))
    inventory = parse_int(request.form.get("inventory"), "Inventory", 0, 100000)
    active = 1 if request.form.get("active") == "on" else 0
    return name, description, price_cents, inventory, active


@app.route("/admin/orders")
@admin_required
def admin_orders():
    rows = query_all(
        "SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id ORDER BY o.created_at DESC"
    )
    return render_template("admin/orders.html", orders=rows)


@app.route("/admin/orders/<int:order_id>", methods=["GET", "POST"])
@admin_required
def admin_order_detail(order_id):
    order = query_one("SELECT o.*, u.email FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?", (order_id,))
    if not order:
        abort(404)
    if request.method == "POST":
        status = request.form.get("status")
        if status not in STATUSES:
            abort(400)
        db().execute("UPDATE orders SET status = ? WHERE id = ?", (status, order_id))
        db().commit()
        return redirect(url_for("admin_order_detail", order_id=order_id))
    items = query_all("SELECT * FROM order_items WHERE order_id = ? ORDER BY id", (order_id,))
    return render_template("admin/order_detail.html", order=order, items=items, statuses=STATUSES)


@app.errorhandler(Exception)
def handle_error(error):
    if isinstance(error, HTTPException):
        code = error.code
    else:
        code = 500
    return render_template("error.html", code=code), code


@app.template_filter("price_input")
def price_input(cents):
    return f"{Decimal(cents or 0) / Decimal(100):.2f}"


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5097, debug=False)
