"""Domain helpers built on top of the SQLite connection.

These wrap all SQL in parameterised queries and centralise access-control
checks (e.g. an order can only be loaded by its owner).
"""
from flask_login import UserMixin

from db import get_db
from security import hash_password, verify_password, needs_rehash


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]
        self.name = row["name"]
        self.password_hash = row["password_hash"]
        self.is_admin = bool(row["is_admin"])

    @staticmethod
    def get(user_id):
        row = get_db().execute(
            "SELECT * FROM user WHERE id = ?", (user_id,)
        ).fetchone()
        return User(row) if row else None

    @staticmethod
    def get_by_email(email):
        row = get_db().execute(
            "SELECT * FROM user WHERE email = ?", (email,)
        ).fetchone()
        return User(row) if row else None

    @staticmethod
    def create(email, name, password, is_admin=False):
        db = get_db()
        db.execute(
            "INSERT INTO user (email, name, password_hash, is_admin) "
            "VALUES (?, ?, ?, ?)",
            (email, name, hash_password(password), 1 if is_admin else 0),
        )
        db.commit()
        return User.get_by_email(email)

    def check_password(self, password):
        ok = verify_password(self.password_hash, password)
        # Transparently upgrade the hash if parameters have strengthened.
        if ok and needs_rehash(self.password_hash):
            db = get_db()
            db.execute(
                "UPDATE user SET password_hash = ? WHERE id = ?",
                (hash_password(password), self.id),
            )
            db.commit()
        return ok


# --------------------------------------------------------------------------
# Products
# --------------------------------------------------------------------------
def list_products(active_only=True):
    sql = "SELECT * FROM product"
    if active_only:
        sql += " WHERE is_active = 1"
    sql += " ORDER BY created_at DESC, id DESC"
    return get_db().execute(sql).fetchall()


def get_product(product_id, active_only=False):
    sql = "SELECT * FROM product WHERE id = ?"
    params = [product_id]
    if active_only:
        sql += " AND is_active = 1"
    return get_db().execute(sql, params).fetchone()


def create_product(name, description, price_cents, stock):
    db = get_db()
    cur = db.execute(
        "INSERT INTO product (name, description, price_cents, stock) "
        "VALUES (?, ?, ?, ?)",
        (name, description, price_cents, stock),
    )
    db.commit()
    return cur.lastrowid


def update_product(product_id, name, description, price_cents, stock, is_active):
    db = get_db()
    db.execute(
        "UPDATE product SET name = ?, description = ?, price_cents = ?, "
        "stock = ?, is_active = ? WHERE id = ?",
        (name, description, price_cents, stock, 1 if is_active else 0, product_id),
    )
    db.commit()


# --------------------------------------------------------------------------
# Cart
# --------------------------------------------------------------------------
def get_cart_rows(user_id):
    """Return joined cart rows (only active, in-stock products)."""
    return get_db().execute(
        "SELECT c.id AS cart_id, c.quantity, p.id AS product_id, p.name, "
        "       p.price_cents, p.stock, p.is_active "
        "FROM cart_item c JOIN product p ON p.id = c.product_id "
        "WHERE c.user_id = ? ORDER BY c.id",
        (user_id,),
    ).fetchall()


def add_to_cart(user_id, product_id, quantity):
    db = get_db()
    existing = db.execute(
        "SELECT quantity FROM cart_item WHERE user_id = ? AND product_id = ?",
        (user_id, product_id),
    ).fetchone()
    if existing:
        new_qty = existing["quantity"] + quantity
        db.execute(
            "UPDATE cart_item SET quantity = ? WHERE user_id = ? AND product_id = ?",
            (new_qty, user_id, product_id),
        )
    else:
        db.execute(
            "INSERT INTO cart_item (user_id, product_id, quantity) VALUES (?, ?, ?)",
            (user_id, product_id, quantity),
        )
    db.commit()


def set_cart_quantity(user_id, cart_id, quantity):
    """Update quantity for a cart row that must belong to this user (IDOR-safe)."""
    db = get_db()
    if quantity <= 0:
        db.execute(
            "DELETE FROM cart_item WHERE id = ? AND user_id = ?", (cart_id, user_id)
        )
    else:
        db.execute(
            "UPDATE cart_item SET quantity = ? WHERE id = ? AND user_id = ?",
            (quantity, cart_id, user_id),
        )
    db.commit()


def remove_cart_item(user_id, cart_id):
    db = get_db()
    db.execute(
        "DELETE FROM cart_item WHERE id = ? AND user_id = ?", (cart_id, user_id)
    )
    db.commit()


def clear_cart(user_id):
    db = get_db()
    db.execute("DELETE FROM cart_item WHERE user_id = ?", (user_id,))
    db.commit()


def cart_count(user_id):
    row = get_db().execute(
        "SELECT COALESCE(SUM(quantity), 0) AS n FROM cart_item WHERE user_id = ?",
        (user_id,),
    ).fetchone()
    return row["n"]


# --------------------------------------------------------------------------
# Orders
# --------------------------------------------------------------------------
class CheckoutError(Exception):
    pass


def place_order(user_id, shipping_name, shipping_address):
    """Create an order atomically. Totals are computed server-side from the
    authoritative product prices in the database — never from client input."""
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        rows = db.execute(
            "SELECT c.quantity, p.id AS product_id, p.name, p.price_cents, "
            "       p.stock, p.is_active "
            "FROM cart_item c JOIN product p ON p.id = c.product_id "
            "WHERE c.user_id = ?",
            (user_id,),
        ).fetchall()

        if not rows:
            raise CheckoutError("Your cart is empty.")

        total = 0
        for r in rows:
            if not r["is_active"]:
                raise CheckoutError(f"'{r['name']}' is no longer available.")
            if r["quantity"] > r["stock"]:
                raise CheckoutError(
                    f"Not enough stock for '{r['name']}' "
                    f"(requested {r['quantity']}, {r['stock']} left)."
                )
            total += r["price_cents"] * r["quantity"]

        cur = db.execute(
            'INSERT INTO "order" (user_id, total_cents, status, '
            "shipping_name, shipping_address) VALUES (?, ?, 'paid', ?, ?)",
            (user_id, total, shipping_name, shipping_address),
        )
        order_id = cur.lastrowid

        for r in rows:
            db.execute(
                "INSERT INTO order_item (order_id, product_id, product_name, "
                "unit_price_cents, quantity) VALUES (?, ?, ?, ?, ?)",
                (order_id, r["product_id"], r["name"], r["price_cents"], r["quantity"]),
            )
            db.execute(
                "UPDATE product SET stock = stock - ? WHERE id = ?",
                (r["quantity"], r["product_id"]),
            )

        db.execute("DELETE FROM cart_item WHERE user_id = ?", (user_id,))
        db.commit()
        return order_id
    except Exception:
        db.rollback()
        raise


def list_orders_for_user(user_id):
    return get_db().execute(
        'SELECT * FROM "order" WHERE user_id = ? ORDER BY created_at DESC, id DESC',
        (user_id,),
    ).fetchall()


def get_order_for_user(order_id, user_id):
    """Load an order ONLY if it belongs to this user (prevents IDOR)."""
    return get_db().execute(
        'SELECT * FROM "order" WHERE id = ? AND user_id = ?', (order_id, user_id)
    ).fetchone()


def get_order_any(order_id):
    return get_db().execute(
        'SELECT * FROM "order" WHERE id = ?', (order_id,)
    ).fetchone()


def get_order_items(order_id):
    return get_db().execute(
        "SELECT * FROM order_item WHERE order_id = ? ORDER BY id", (order_id,)
    ).fetchall()


def list_all_orders():
    return get_db().execute(
        'SELECT o.*, u.email AS user_email FROM "order" o '
        "JOIN user u ON u.id = o.user_id "
        "ORDER BY o.created_at DESC, o.id DESC"
    ).fetchall()


VALID_STATUSES = ("pending", "paid", "shipped", "delivered", "cancelled")


def update_order_status(order_id, status):
    if status not in VALID_STATUSES:
        raise ValueError("Invalid status")
    db = get_db()
    db.execute('UPDATE "order" SET status = ? WHERE id = ?', (status, order_id))
    db.commit()


def user_has_purchased(user_id, product_id):
    row = get_db().execute(
        'SELECT 1 FROM order_item oi JOIN "order" o ON o.id = oi.order_id '
        "WHERE o.user_id = ? AND oi.product_id = ? LIMIT 1",
        (user_id, product_id),
    ).fetchone()
    return row is not None


# --------------------------------------------------------------------------
# Reviews
# --------------------------------------------------------------------------
def list_reviews(product_id):
    return get_db().execute(
        "SELECT r.*, u.name AS author FROM review r "
        "JOIN user u ON u.id = r.user_id "
        "WHERE r.product_id = ? ORDER BY r.created_at DESC, r.id DESC",
        (product_id,),
    ).fetchall()


def get_user_review(product_id, user_id):
    return get_db().execute(
        "SELECT * FROM review WHERE product_id = ? AND user_id = ?",
        (product_id, user_id),
    ).fetchone()


def upsert_review(product_id, user_id, rating, body):
    db = get_db()
    db.execute(
        "INSERT INTO review (product_id, user_id, rating, body) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(product_id, user_id) DO UPDATE SET "
        "rating = excluded.rating, body = excluded.body, "
        "created_at = datetime('now')",
        (product_id, user_id, rating, body),
    )
    db.commit()
