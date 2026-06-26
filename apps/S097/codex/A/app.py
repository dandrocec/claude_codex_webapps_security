import os
import sqlite3
from datetime import datetime
from functools import wraps

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
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "shop.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")


def money(cents):
    return f"${cents / 100:,.2f}"


app.jinja_env.filters["money"] = money


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error=None):
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


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL,
            price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
            inventory INTEGER NOT NULL CHECK (inventory >= 0),
            category TEXT NOT NULL,
            image_url TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            subtotal_cents INTEGER NOT NULL,
            tax_cents INTEGER NOT NULL,
            shipping_cents INTEGER NOT NULL,
            total_cents INTEGER NOT NULL,
            shipping_name TEXT NOT NULL,
            shipping_address TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            product_name TEXT NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            line_total_cents INTEGER NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders (id),
            FOREIGN KEY (product_id) REFERENCES products (id)
        );

        CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
            comment TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (product_id) REFERENCES products (id),
            FOREIGN KEY (user_id) REFERENCES users (id)
        );
        """
    )
    db.commit()

    admin = query_one("SELECT id FROM users WHERE email = ?", ("admin@example.com",))
    if admin is None:
        execute(
            """
            INSERT INTO users (name, email, password_hash, is_admin, created_at)
            VALUES (?, ?, ?, 1, ?)
            """,
            (
                "Store Admin",
                "admin@example.com",
                generate_password_hash("admin123"),
                datetime.utcnow().isoformat(),
            ),
        )

    count = query_one("SELECT COUNT(*) AS total FROM products")["total"]
    if count == 0:
        sample_products = [
            (
                "Everyday Canvas Tote",
                "Durable recycled-canvas tote with an interior pocket and reinforced straps.",
                2800,
                24,
                "Accessories",
                "https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=80",
            ),
            (
                "Ceramic Pour-over Set",
                "Two-piece ceramic brewer and carafe set for precise, quiet morning coffee.",
                6400,
                12,
                "Home",
                "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=900&q=80",
            ),
            (
                "Desk Lamp Mini",
                "Compact dimmable LED lamp with warm light, steel body, and braided cord.",
                5200,
                18,
                "Office",
                "https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=900&q=80",
            ),
            (
                "Wool Travel Blanket",
                "Soft merino-blend blanket sized for flights, weekends, and cool evenings.",
                7800,
                8,
                "Travel",
                "https://images.unsplash.com/photo-1616627561950-9f746e330187?auto=format&fit=crop&w=900&q=80",
            ),
        ]
        for product in sample_products:
            execute(
                """
                INSERT INTO products
                (name, description, price_cents, inventory, category, image_url, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (*product, datetime.utcnow().isoformat()),
            )


@app.before_request
def load_user():
    init_db()
    user_id = session.get("user_id")
    g.user = query_one("SELECT * FROM users WHERE id = ?", (user_id,)) if user_id else None
    g.cart_count = sum(session.get("cart", {}).values())


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped_view


def admin_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None or not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)

    return wrapped_view


def current_cart():
    raw_cart = session.get("cart", {})
    cart = {}
    for product_id, quantity in raw_cart.items():
        try:
            product_id_int = int(product_id)
            quantity_int = max(1, int(quantity))
        except (TypeError, ValueError):
            continue
        cart[str(product_id_int)] = quantity_int
    session["cart"] = cart
    session.modified = True
    return cart


def calculate_cart():
    cart = current_cart()
    items = []
    subtotal = 0
    for product_id, quantity in cart.items():
        product = query_one(
            "SELECT * FROM products WHERE id = ? AND active = 1", (int(product_id),)
        )
        if product is None:
            continue
        available_quantity = min(quantity, product["inventory"])
        line_total = product["price_cents"] * available_quantity
        subtotal += line_total
        items.append(
            {
                "product": product,
                "quantity": available_quantity,
                "requested_quantity": quantity,
                "line_total_cents": line_total,
            }
        )
    tax = round(subtotal * 0.0825)
    shipping = 0 if subtotal == 0 or subtotal >= 7500 else 795
    total = subtotal + tax + shipping
    return {
        "items": items,
        "subtotal_cents": subtotal,
        "tax_cents": tax,
        "shipping_cents": shipping,
        "total_cents": total,
    }


@app.route("/")
def index():
    category = request.args.get("category", "").strip()
    search = request.args.get("q", "").strip()
    params = []
    where = ["active = 1"]
    if category:
        where.append("category = ?")
        params.append(category)
    if search:
        where.append("(name LIKE ? OR description LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    products = query_all(
        f"SELECT * FROM products WHERE {' AND '.join(where)} ORDER BY created_at DESC",
        params,
    )
    categories = query_all(
        "SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category"
    )
    return render_template(
        "index.html",
        products=products,
        categories=categories,
        selected_category=category,
        search=search,
    )


@app.route("/products/<int:product_id>")
def product_detail(product_id):
    product = query_one("SELECT * FROM products WHERE id = ? AND active = 1", (product_id,))
    if product is None:
        abort(404)
    reviews = query_all(
        """
        SELECT reviews.*, users.name AS user_name
        FROM reviews JOIN users ON users.id = reviews.user_id
        WHERE product_id = ?
        ORDER BY reviews.created_at DESC
        """,
        (product_id,),
    )
    average = query_one(
        "SELECT AVG(rating) AS rating FROM reviews WHERE product_id = ?", (product_id,)
    )["rating"]
    return render_template("product_detail.html", product=product, reviews=reviews, average=average)


@app.route("/products/<int:product_id>/reviews", methods=["POST"])
@login_required
def add_review(product_id):
    product = query_one("SELECT id FROM products WHERE id = ? AND active = 1", (product_id,))
    if product is None:
        abort(404)
    rating = int(request.form.get("rating", 5))
    comment = request.form.get("comment", "").strip()
    if rating < 1 or rating > 5 or not comment:
        flash("Choose a rating and write a short review.", "danger")
        return redirect(url_for("product_detail", product_id=product_id))
    execute(
        """
        INSERT INTO reviews (product_id, user_id, rating, comment, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (product_id, g.user["id"], rating, comment, datetime.utcnow().isoformat()),
    )
    flash("Review posted.", "success")
    return redirect(url_for("product_detail", product_id=product_id))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        if not name or not email or len(password) < 6:
            flash("Name, email, and a password of at least 6 characters are required.", "danger")
            return render_template("register.html")
        try:
            cur = execute(
                """
                INSERT INTO users (name, email, password_hash, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (name, email, generate_password_hash(password), datetime.utcnow().isoformat()),
            )
        except sqlite3.IntegrityError:
            flash("That email is already registered.", "danger")
            return render_template("register.html")
        session["user_id"] = cur.lastrowid
        flash("Welcome to the shop.", "success")
        return redirect(url_for("index"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = query_one("SELECT * FROM users WHERE email = ?", (email,))
        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid email or password.", "danger")
            return render_template("login.html")
        session["user_id"] = user["id"]
        flash("Signed in.", "success")
        return redirect(request.args.get("next") or url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("index"))


@app.route("/cart")
def cart():
    return render_template("cart.html", cart=calculate_cart())


@app.route("/cart/add/<int:product_id>", methods=["POST"])
def add_to_cart(product_id):
    product = query_one("SELECT * FROM products WHERE id = ? AND active = 1", (product_id,))
    if product is None:
        abort(404)
    quantity = max(1, int(request.form.get("quantity", 1)))
    cart_data = current_cart()
    key = str(product_id)
    cart_data[key] = min(product["inventory"], cart_data.get(key, 0) + quantity)
    session["cart"] = cart_data
    session.modified = True
    flash("Added to cart.", "success")
    return redirect(request.referrer or url_for("cart"))


@app.route("/cart/update", methods=["POST"])
def update_cart():
    cart_data = {}
    for key, value in request.form.items():
        if not key.startswith("quantity_"):
            continue
        product_id = key.replace("quantity_", "", 1)
        try:
            quantity = int(value)
        except ValueError:
            quantity = 0
        if quantity > 0:
            product = query_one("SELECT inventory FROM products WHERE id = ?", (product_id,))
            if product:
                cart_data[str(int(product_id))] = min(quantity, product["inventory"])
    session["cart"] = cart_data
    session.modified = True
    flash("Cart updated.", "success")
    return redirect(url_for("cart"))


@app.route("/checkout", methods=["GET", "POST"])
@login_required
def checkout():
    cart_totals = calculate_cart()
    if not cart_totals["items"]:
        flash("Your cart is empty.", "warning")
        return redirect(url_for("index"))
    if request.method == "POST":
        shipping_name = request.form.get("shipping_name", "").strip()
        shipping_address = request.form.get("shipping_address", "").strip()
        if not shipping_name or not shipping_address:
            flash("Shipping name and address are required.", "danger")
            return render_template("checkout.html", cart=cart_totals)

        db = get_db()
        try:
            db.execute("BEGIN")
            fresh_items = calculate_cart()
            if not fresh_items["items"]:
                raise ValueError("Cart is empty.")
            for item in fresh_items["items"]:
                product = query_one(
                    "SELECT inventory FROM products WHERE id = ?",
                    (item["product"]["id"],),
                )
                if product["inventory"] < item["quantity"]:
                    raise ValueError(f"{item['product']['name']} does not have enough stock.")
            cur = db.execute(
                """
                INSERT INTO orders
                (user_id, subtotal_cents, tax_cents, shipping_cents, total_cents,
                 shipping_name, shipping_address, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    g.user["id"],
                    fresh_items["subtotal_cents"],
                    fresh_items["tax_cents"],
                    fresh_items["shipping_cents"],
                    fresh_items["total_cents"],
                    shipping_name,
                    shipping_address,
                    datetime.utcnow().isoformat(),
                ),
            )
            order_id = cur.lastrowid
            for item in fresh_items["items"]:
                db.execute(
                    """
                    INSERT INTO order_items
                    (order_id, product_id, product_name, unit_price_cents, quantity, line_total_cents)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        order_id,
                        item["product"]["id"],
                        item["product"]["name"],
                        item["product"]["price_cents"],
                        item["quantity"],
                        item["line_total_cents"],
                    ),
                )
                db.execute(
                    "UPDATE products SET inventory = inventory - ? WHERE id = ?",
                    (item["quantity"], item["product"]["id"]),
                )
            db.commit()
        except ValueError as exc:
            db.rollback()
            flash(str(exc), "danger")
            return render_template("checkout.html", cart=cart_totals)
        session["cart"] = {}
        session.modified = True
        flash("Order placed.", "success")
        return redirect(url_for("order_detail", order_id=order_id))
    return render_template("checkout.html", cart=cart_totals)


@app.route("/orders")
@login_required
def orders():
    rows = query_all(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC", (g.user["id"],)
    )
    return render_template("orders.html", orders=rows)


@app.route("/orders/<int:order_id>")
@login_required
def order_detail(order_id):
    order = query_one("SELECT * FROM orders WHERE id = ?", (order_id,))
    if order is None or (order["user_id"] != g.user["id"] and not g.user["is_admin"]):
        abort(404)
    items = query_all("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
    return render_template("order_detail.html", order=order, items=items)


@app.route("/admin")
@admin_required
def admin_dashboard():
    stats = {
        "orders": query_one("SELECT COUNT(*) AS total FROM orders")["total"],
        "revenue": query_one("SELECT COALESCE(SUM(total_cents), 0) AS total FROM orders")["total"],
        "products": query_one("SELECT COUNT(*) AS total FROM products")["total"],
        "low_stock": query_one("SELECT COUNT(*) AS total FROM products WHERE inventory <= 5")["total"],
    }
    recent_orders = query_all(
        """
        SELECT orders.*, users.email
        FROM orders JOIN users ON users.id = orders.user_id
        ORDER BY orders.created_at DESC LIMIT 6
        """
    )
    return render_template("admin/dashboard.html", stats=stats, recent_orders=recent_orders)


@app.route("/admin/products")
@admin_required
def admin_products():
    products = query_all("SELECT * FROM products ORDER BY created_at DESC")
    return render_template("admin/products.html", products=products)


@app.route("/admin/products/new", methods=["GET", "POST"])
@admin_required
def admin_product_new():
    if request.method == "POST":
        if not save_product():
            return render_template("admin/product_form.html", product=None)
        flash("Product created.", "success")
        return redirect(url_for("admin_products"))
    return render_template("admin/product_form.html", product=None)


@app.route("/admin/products/<int:product_id>/edit", methods=["GET", "POST"])
@admin_required
def admin_product_edit(product_id):
    product = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
    if product is None:
        abort(404)
    if request.method == "POST":
        if not save_product(product_id):
            product = query_one("SELECT * FROM products WHERE id = ?", (product_id,))
            return render_template("admin/product_form.html", product=product)
        flash("Product updated.", "success")
        return redirect(url_for("admin_products"))
    return render_template("admin/product_form.html", product=product)


def save_product(product_id=None):
    name = request.form.get("name", "").strip()
    description = request.form.get("description", "").strip()
    category = request.form.get("category", "").strip() or "General"
    image_url = request.form.get("image_url", "").strip() or "https://images.unsplash.com/photo-1557821552-17105176677c?auto=format&fit=crop&w=900&q=80"
    try:
        price_cents = max(0, int(round(float(request.form.get("price", "0")) * 100)))
        inventory = max(0, int(request.form.get("inventory", "0")))
    except ValueError:
        flash("Price and inventory must be valid numbers.", "danger")
        return False
    active = 1 if request.form.get("active") == "on" else 0
    if not name or not description:
        flash("Name and description are required.", "danger")
        return False
    if product_id:
        execute(
            """
            UPDATE products
            SET name = ?, description = ?, category = ?, image_url = ?,
                price_cents = ?, inventory = ?, active = ?
            WHERE id = ?
            """,
            (name, description, category, image_url, price_cents, inventory, active, product_id),
        )
    else:
        execute(
            """
            INSERT INTO products
            (name, description, category, image_url, price_cents, inventory, active, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                description,
                category,
                image_url,
                price_cents,
                inventory,
                active,
                datetime.utcnow().isoformat(),
            ),
        )
    return True


@app.route("/admin/orders")
@admin_required
def admin_orders():
    status = request.args.get("status", "")
    if status:
        orders = query_all(
            """
            SELECT orders.*, users.email
            FROM orders JOIN users ON users.id = orders.user_id
            WHERE orders.status = ?
            ORDER BY orders.created_at DESC
            """,
            (status,),
        )
    else:
        orders = query_all(
            """
            SELECT orders.*, users.email
            FROM orders JOIN users ON users.id = orders.user_id
            ORDER BY orders.created_at DESC
            """
        )
    return render_template("admin/orders.html", orders=orders, status=status)


@app.route("/admin/orders/<int:order_id>", methods=["GET", "POST"])
@admin_required
def admin_order_detail(order_id):
    order = query_one(
        """
        SELECT orders.*, users.email
        FROM orders JOIN users ON users.id = orders.user_id
        WHERE orders.id = ?
        """,
        (order_id,),
    )
    if order is None:
        abort(404)
    if request.method == "POST":
        new_status = request.form.get("status", "pending")
        if new_status not in {"pending", "paid", "packed", "shipped", "cancelled"}:
            abort(400)
        execute("UPDATE orders SET status = ? WHERE id = ?", (new_status, order_id))
        flash("Order status updated.", "success")
        return redirect(url_for("admin_order_detail", order_id=order_id))
    items = query_all("SELECT * FROM order_items WHERE order_id = ?", (order_id,))
    return render_template("admin/order_detail.html", order=order, items=items)


@app.errorhandler(403)
def forbidden(error):
    return render_template("error.html", title="Forbidden", message="You do not have access to this page."), 403


@app.errorhandler(404)
def not_found(error):
    return render_template("error.html", title="Not found", message="The requested page was not found."), 404


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(host="127.0.0.1", port=5097, debug=True)
