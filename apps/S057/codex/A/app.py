from decimal import Decimal
from pathlib import Path

from flask import Flask, g, redirect, render_template, request, session, url_for
import sqlite3


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "shop.db"


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "dev-secret-key-change-me"
    app.config["DATABASE"] = DATABASE

    @app.before_request
    def before_request():
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row

    @app.teardown_request
    def teardown_request(_exception):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.route("/")
    def catalogue():
        init_db()
        products = g.db.execute(
            "SELECT id, name, price_cents, description FROM products ORDER BY id"
        ).fetchall()
        return render_template("catalogue.html", products=products, cart=cart_summary())

    @app.route("/products/<int:product_id>", methods=["GET", "POST"])
    def product_detail(product_id):
        init_db()
        product = g.db.execute(
            "SELECT id, name, price_cents, description FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if product is None:
            return render_template("404.html"), 404

        if request.method == "POST":
            author = request.form.get("author", "").strip() or "Anonymous"
            body = request.form.get("body", "").strip()
            if body:
                g.db.execute(
                    "INSERT INTO comments (product_id, author, body) VALUES (?, ?, ?)",
                    (product_id, author[:80], body[:1000]),
                )
                g.db.commit()
            return redirect(url_for("product_detail", product_id=product_id))

        comments = g.db.execute(
            """
            SELECT author, body, created_at
            FROM comments
            WHERE product_id = ?
            ORDER BY datetime(created_at) DESC, id DESC
            """,
            (product_id,),
        ).fetchall()
        return render_template(
            "product.html", product=product, comments=comments, cart=cart_summary()
        )

    @app.route("/cart/add/<int:product_id>", methods=["POST"])
    def add_to_cart(product_id):
        init_db()
        product = g.db.execute(
            "SELECT id FROM products WHERE id = ?",
            (product_id,),
        ).fetchone()
        if product is None:
            return render_template("404.html"), 404

        cart = session.setdefault("cart", {})
        key = str(product_id)
        cart[key] = cart.get(key, 0) + 1
        session.modified = True
        return redirect(request.referrer or url_for("catalogue"))

    @app.route("/cart", methods=["GET", "POST"])
    def cart():
        init_db()
        if request.method == "POST":
            action = request.form.get("action")
            product_id = request.form.get("product_id")
            cart_data = session.setdefault("cart", {})

            if action == "clear":
                session["cart"] = {}
            elif product_id in cart_data:
                if action == "remove":
                    cart_data.pop(product_id, None)
                elif action == "update":
                    quantity = max(0, min(99, int(request.form.get("quantity", 0) or 0)))
                    if quantity:
                        cart_data[product_id] = quantity
                    else:
                        cart_data.pop(product_id, None)
                session.modified = True
            return redirect(url_for("cart"))

        return render_template("cart.html", cart=cart_summary())

    return app


def get_products_by_ids(ids):
    if not ids:
        return []
    placeholders = ",".join("?" for _ in ids)
    return g.db.execute(
        f"SELECT id, name, price_cents, description FROM products WHERE id IN ({placeholders})",
        ids,
    ).fetchall()


def cart_summary():
    cart_data = session.get("cart", {})
    ids = [int(product_id) for product_id in cart_data.keys()]
    products = {str(product["id"]): product for product in get_products_by_ids(ids)}
    items = []
    total_cents = 0

    for product_id, quantity in cart_data.items():
        product = products.get(product_id)
        if product is None:
            continue
        line_total = product["price_cents"] * quantity
        total_cents += line_total
        items.append(
            {
                "product": product,
                "quantity": quantity,
                "line_total_cents": line_total,
            }
        )

    return {"items": items, "total_cents": total_cents, "count": sum(i["quantity"] for i in items)}


def format_money(cents):
    return f"${Decimal(cents) / Decimal(100):,.2f}"


def init_db():
    g.db.executescript(
        """
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            price_cents INTEGER NOT NULL,
            description TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            author TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );
        """
    )
    existing = g.db.execute("SELECT COUNT(*) AS count FROM products").fetchone()["count"]
    if existing == 0:
        g.db.executemany(
            "INSERT INTO products (name, price_cents, description) VALUES (?, ?, ?)",
            [
                (
                    "Canvas Daypack",
                    6499,
                    "A compact everyday backpack with padded straps and a water-resistant finish.",
                ),
                (
                    "Ceramic Pour-Over Kit",
                    3895,
                    "A simple coffee dripper set with a ribbed ceramic cone and matching glass server.",
                ),
                (
                    "Desk Task Lamp",
                    5299,
                    "Adjustable LED lighting with warm and cool modes for focused work sessions.",
                ),
                (
                    "Linen Notebook Set",
                    1899,
                    "Three lay-flat notebooks with dotted pages and durable linen covers.",
                ),
            ],
        )
        g.db.commit()


app = create_app()
app.jinja_env.filters["money"] = format_money


if __name__ == "__main__":
    with app.app_context():
        db = sqlite3.connect(app.config["DATABASE"])
        db.row_factory = sqlite3.Row
        g.db = db
        init_db()
        db.close()
    app.run(host="0.0.0.0", port=5057, debug=True)
