"""Flask inventory tracker.

A small single-file application that lets logged-in users manage an
inventory: add items, adjust quantities, search, and see which items have
fallen below their low-stock threshold. Data is stored in SQLite.
"""

import os
import sqlite3
from contextlib import closing

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "inventory.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = DATABASE

login_manager = LoginManager()
login_manager.login_view = "login"
login_manager.init_app(app)


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables and seed a default user if the database is empty."""
    with closing(sqlite3.connect(app.config["DATABASE"])) as db:
        db.row_factory = sqlite3.Row
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS items (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT NOT NULL,
                sku       TEXT UNIQUE NOT NULL,
                quantity  INTEGER NOT NULL DEFAULT 0,
                location  TEXT NOT NULL DEFAULT '',
                low_stock INTEGER NOT NULL DEFAULT 5
            );
            """
        )
        # Seed a default login so the app is usable out of the box.
        existing = db.execute("SELECT COUNT(*) AS n FROM users").fetchone()
        if existing["n"] == 0:
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                ("admin", generate_password_hash("admin")),
            )
        db.commit()


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]


@login_manager.user_loader
def load_user(user_id):
    row = get_db().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return User(row) if row else None


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        row = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if row and check_password_hash(row["password_hash"], password):
            login_user(User(row))
            return redirect(request.args.get("next") or url_for("index"))
        flash("Invalid username or password.", "error")

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    return redirect(url_for("login"))


# --------------------------------------------------------------------------- #
# Inventory views
# --------------------------------------------------------------------------- #
@app.route("/")
@login_required
def index():
    query = request.args.get("q", "").strip()
    db = get_db()
    if query:
        like = f"%{query}%"
        items = db.execute(
            """
            SELECT * FROM items
            WHERE name LIKE ? OR sku LIKE ? OR location LIKE ?
            ORDER BY name COLLATE NOCASE
            """,
            (like, like, like),
        ).fetchall()
    else:
        items = db.execute(
            "SELECT * FROM items ORDER BY name COLLATE NOCASE"
        ).fetchall()

    low_count = sum(1 for item in items if item["quantity"] <= item["low_stock"])
    return render_template(
        "index.html", items=items, query=query, low_count=low_count
    )


@app.route("/add", methods=["GET", "POST"])
@login_required
def add_item():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        sku = request.form.get("sku", "").strip()
        location = request.form.get("location", "").strip()
        quantity = request.form.get("quantity", "0").strip()
        low_stock = request.form.get("low_stock", "5").strip()

        errors = []
        if not name:
            errors.append("Name is required.")
        if not sku:
            errors.append("SKU is required.")
        quantity = _to_int(quantity, default=None)
        low_stock = _to_int(low_stock, default=None)
        if quantity is None or quantity < 0:
            errors.append("Quantity must be a non-negative whole number.")
        if low_stock is None or low_stock < 0:
            errors.append("Low-stock threshold must be a non-negative whole number.")

        if errors:
            for error in errors:
                flash(error, "error")
            return render_template("add.html", form=request.form)

        try:
            get_db().execute(
                """
                INSERT INTO items (name, sku, quantity, location, low_stock)
                VALUES (?, ?, ?, ?, ?)
                """,
                (name, sku, quantity, location, low_stock),
            )
            get_db().commit()
        except sqlite3.IntegrityError:
            flash(f"An item with SKU '{sku}' already exists.", "error")
            return render_template("add.html", form=request.form)

        flash(f"Added '{name}'.", "success")
        return redirect(url_for("index"))

    return render_template("add.html", form={})


@app.route("/adjust/<int:item_id>", methods=["POST"])
@login_required
def adjust(item_id):
    delta = _to_int(request.form.get("delta", "0"), default=0)
    db = get_db()
    item = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if item is None:
        flash("Item not found.", "error")
        return redirect(url_for("index"))

    new_quantity = max(0, item["quantity"] + delta)
    db.execute(
        "UPDATE items SET quantity = ? WHERE id = ?", (new_quantity, item_id)
    )
    db.commit()
    flash(f"Updated '{item['name']}' to {new_quantity}.", "success")
    return redirect(request.referrer or url_for("index"))


@app.route("/delete/<int:item_id>", methods=["POST"])
@login_required
def delete(item_id):
    db = get_db()
    item = db.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    if item:
        db.execute("DELETE FROM items WHERE id = ?", (item_id,))
        db.commit()
        flash(f"Deleted '{item['name']}'.", "success")
    return redirect(url_for("index"))


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


# Initialise the database as soon as the module is imported so the app is
# runnable via `flask run` or `python app.py` without extra setup steps.
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5047, debug=True)
