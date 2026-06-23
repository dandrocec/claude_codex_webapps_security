"""Data-access functions and the Flask-Login user model.

All SQL uses parameterised queries. Passwords are hashed with bcrypt
(a strong, salted, adaptive algorithm).
"""
import bcrypt
from flask_login import UserMixin

from db import get_db

# bcrypt operates on at most 72 bytes; we also enforce this in form validation.
_BCRYPT_MAX_BYTES = 72


class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]
        self.password_hash = row["password_hash"]
        self.is_admin = bool(row["is_admin"])

    def check_password(self, password: str) -> bool:
        pw = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
        try:
            return bcrypt.checkpw(pw, self.password_hash.encode("utf-8"))
        except ValueError:
            return False


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")[:_BCRYPT_MAX_BYTES]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


# ---- Users -----------------------------------------------------------------

def get_user_by_id(user_id):
    row = get_db().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return User(row) if row else None


def get_user_by_email(email):
    row = get_db().execute(
        "SELECT * FROM users WHERE email = ?", (email,)
    ).fetchone()
    return User(row) if row else None


def create_user(email: str, password: str, is_admin: bool = False) -> int:
    db = get_db()
    cur = db.execute(
        "INSERT INTO users (email, password_hash, is_admin) VALUES (?, ?, ?)",
        (email, hash_password(password), 1 if is_admin else 0),
    )
    db.commit()
    return cur.lastrowid


# ---- Products --------------------------------------------------------------

def list_products():
    return get_db().execute(
        "SELECT * FROM products WHERE active = 1 ORDER BY name"
    ).fetchall()


def get_product(product_id):
    return get_db().execute(
        "SELECT * FROM products WHERE id = ? AND active = 1", (product_id,)
    ).fetchone()


# ---- Orders ----------------------------------------------------------------

def create_order(user_id: int, cart_items, currency: str) -> int:
    """Create a pending order plus its line items inside one transaction.

    `cart_items` is a list of (product_row, quantity). Prices are taken from
    the database, never from the client, so totals cannot be tampered with.
    """
    db = get_db()
    total = sum(p["price_cents"] * qty for p, qty in cart_items)
    cur = db.execute(
        "INSERT INTO orders (user_id, status, total_cents, currency) "
        "VALUES (?, 'pending', ?, ?)",
        (user_id, total, currency),
    )
    order_id = cur.lastrowid
    for product, qty in cart_items:
        db.execute(
            "INSERT INTO order_items "
            "(order_id, product_id, product_name, unit_cents, quantity) "
            "VALUES (?, ?, ?, ?, ?)",
            (order_id, product["id"], product["name"],
             product["price_cents"], qty),
        )
    db.commit()
    return order_id


def set_order_payment_ref(order_id: int, payment_ref: str) -> None:
    db = get_db()
    db.execute(
        "UPDATE orders SET payment_ref = ? WHERE id = ?",
        (payment_ref, order_id),
    )
    db.commit()


def get_order_for_user(order_id, user_id):
    """Fetch an order only if it belongs to `user_id` (prevents IDOR)."""
    return get_db().execute(
        "SELECT * FROM orders WHERE id = ? AND user_id = ?",
        (order_id, user_id),
    ).fetchone()


def get_order(order_id):
    return get_db().execute(
        "SELECT * FROM orders WHERE id = ?", (order_id,)
    ).fetchone()


def get_order_by_payment_ref(payment_ref):
    return get_db().execute(
        "SELECT * FROM orders WHERE payment_ref = ?", (payment_ref,)
    ).fetchone()


def get_order_items(order_id):
    return get_db().execute(
        "SELECT * FROM order_items WHERE order_id = ? ORDER BY id",
        (order_id,),
    ).fetchall()


def list_orders_for_user(user_id):
    return get_db().execute(
        "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        (user_id,),
    ).fetchall()


def list_all_orders():
    return get_db().execute(
        "SELECT o.*, u.email AS user_email "
        "FROM orders o JOIN users u ON u.id = o.user_id "
        "ORDER BY o.created_at DESC, o.id DESC"
    ).fetchall()


def mark_order_paid(order_id: int) -> bool:
    """Idempotently mark a pending order as paid. Returns True if it changed."""
    db = get_db()
    cur = db.execute(
        "UPDATE orders SET status = 'paid', paid_at = datetime('now') "
        "WHERE id = ? AND status = 'pending'",
        (order_id,),
    )
    db.commit()
    return cur.rowcount > 0
