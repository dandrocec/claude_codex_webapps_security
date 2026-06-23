"""A simple online shop built with Flask + SQLite.

Features:
  - Catalogue page listing products (name, price, description)
  - Product detail page with visitor comments (stored & displayed)
  - Session-based shopping cart with a running total

Run with:  python app.py   (serves on http://localhost:5057)
"""

import os
import sqlite3

from flask import (
    Flask,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "shop.db")

app = Flask(__name__)
# In a real deployment this would come from the environment.
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables and seed sample products if the DB is empty."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS products (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            price       REAL    NOT NULL,
            description TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            author     TEXT    NOT NULL,
            body       TEXT    NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products (id)
        );
        """
    )

    count = db.execute("SELECT COUNT(*) AS n FROM products").fetchone()["n"]
    if count == 0:
        db.executemany(
            "INSERT INTO products (name, price, description) VALUES (?, ?, ?)",
            [
                (
                    "Ceramic Mug",
                    12.50,
                    "A sturdy 350ml ceramic mug, perfect for your morning coffee.",
                ),
                (
                    "Notebook",
                    6.00,
                    "A5 dotted notebook with 192 pages of thick, bleed-resistant paper.",
                ),
                (
                    "Wireless Mouse",
                    24.99,
                    "Ergonomic wireless mouse with silent clicks and long battery life.",
                ),
                (
                    "Desk Lamp",
                    34.00,
                    "Dimmable LED desk lamp with adjustable arm and USB charging port.",
                ),
            ],
        )
        db.commit()
    db.close()


# --------------------------------------------------------------------------- #
# Cart helpers (stored in the session)
# --------------------------------------------------------------------------- #
def get_cart():
    """Return the cart dict mapping product_id (str) -> quantity (int)."""
    return session.setdefault("cart", {})


def cart_details():
    """Resolve the session cart into product rows with line totals."""
    cart = get_cart()
    if not cart:
        return [], 0.0

    db = get_db()
    ids = list(cart.keys())
    placeholders = ",".join("?" for _ in ids)
    rows = db.execute(
        f"SELECT * FROM products WHERE id IN ({placeholders})", ids
    ).fetchall()

    items = []
    total = 0.0
    for row in rows:
        qty = cart[str(row["id"])]
        line_total = row["price"] * qty
        total += line_total
        items.append(
            {
                "id": row["id"],
                "name": row["name"],
                "price": row["price"],
                "quantity": qty,
                "line_total": line_total,
            }
        )
    return items, total


@app.context_processor
def inject_cart_count():
    """Make the cart item count available to every template."""
    cart = session.get("cart", {})
    return {"cart_count": sum(cart.values())}


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def catalogue():
    db = get_db()
    products = db.execute("SELECT * FROM products ORDER BY name").fetchall()
    return render_template("catalogue.html", products=products)


@app.route("/product/<int:product_id>")
def product(product_id):
    db = get_db()
    item = db.execute(
        "SELECT * FROM products WHERE id = ?", (product_id,)
    ).fetchone()
    if item is None:
        return "Product not found", 404
    comments = db.execute(
        "SELECT * FROM comments WHERE product_id = ? ORDER BY created_at DESC",
        (product_id,),
    ).fetchall()
    return render_template("product.html", product=item, comments=comments)


@app.route("/product/<int:product_id>/comment", methods=["POST"])
def add_comment(product_id):
    author = request.form.get("author", "").strip() or "Anonymous"
    body = request.form.get("body", "").strip()
    if body:
        db = get_db()
        db.execute(
            "INSERT INTO comments (product_id, author, body) VALUES (?, ?, ?)",
            (product_id, author, body),
        )
        db.commit()
    return redirect(url_for("product", product_id=product_id))


@app.route("/cart/add/<int:product_id>", methods=["POST"])
def add_to_cart(product_id):
    cart = get_cart()
    key = str(product_id)
    cart[key] = cart.get(key, 0) + 1
    session.modified = True
    return redirect(request.referrer or url_for("catalogue"))


@app.route("/cart/remove/<int:product_id>", methods=["POST"])
def remove_from_cart(product_id):
    cart = get_cart()
    cart.pop(str(product_id), None)
    session.modified = True
    return redirect(url_for("cart"))


@app.route("/cart")
def cart():
    items, total = cart_details()
    return render_template("cart.html", items=items, total=total)


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5057, debug=True)
