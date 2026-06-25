import os
import sqlite3
from functools import wraps

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


DATABASE = os.path.join(os.path.dirname(__file__), "inventory.sqlite3")
LOW_STOCK_THRESHOLD = 5


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-inventory-secret")


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


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sku TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            location TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, sku),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        """
    )
    db.commit()


@app.before_request
def ensure_schema():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id:
        g.user = get_db().execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


@app.route("/")
def index():
    if g.user:
        return redirect(url_for("inventory"))
    return redirect(url_for("login"))


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username:
            flash("Username is required.", "error")
        elif not password:
            flash("Password is required.", "error")
        else:
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
            else:
                flash("Account created. Sign in to continue.", "success")
                return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("inventory"))

    return render_template("login.html")


@app.route("/logout", methods=("POST",))
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/inventory", methods=("GET", "POST"))
@login_required
def inventory():
    db = get_db()

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        sku = request.form.get("sku", "").strip()
        location = request.form.get("location", "").strip()
        quantity_raw = request.form.get("quantity", "0").strip()

        try:
            quantity = int(quantity_raw)
        except ValueError:
            quantity = -1

        if not name or not sku or not location:
            flash("Name, SKU, and location are required.", "error")
        elif quantity < 0:
            flash("Quantity must be a whole number of 0 or more.", "error")
        else:
            try:
                db.execute(
                    """
                    INSERT INTO items (user_id, name, sku, quantity, location)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (g.user["id"], name, sku, quantity, location),
                )
                db.commit()
                flash("Item added.", "success")
            except sqlite3.IntegrityError:
                flash("An item with that SKU already exists.", "error")

        return redirect(url_for("inventory", q=request.args.get("q", "")))

    query = request.args.get("q", "").strip()
    params = [g.user["id"]]
    sql = """
        SELECT * FROM items
        WHERE user_id = ?
    """
    if query:
        sql += " AND (name LIKE ? OR sku LIKE ? OR location LIKE ?)"
        like_query = f"%{query}%"
        params.extend([like_query, like_query, like_query])
    sql += " ORDER BY quantity ASC, name COLLATE NOCASE ASC"

    items = db.execute(sql, params).fetchall()
    return render_template(
        "inventory.html",
        items=items,
        query=query,
        low_stock_threshold=LOW_STOCK_THRESHOLD,
    )


@app.route("/items/<int:item_id>/adjust", methods=("POST",))
@login_required
def adjust_item(item_id):
    raw_delta = request.form.get("delta", "0").strip()
    try:
        delta = int(raw_delta)
    except ValueError:
        flash("Adjustment must be a whole number.", "error")
        return redirect(url_for("inventory", q=request.form.get("q", "")))

    db = get_db()
    item = db.execute(
        "SELECT * FROM items WHERE id = ? AND user_id = ?", (item_id, g.user["id"])
    ).fetchone()
    if item is None:
        flash("Item not found.", "error")
        return redirect(url_for("inventory", q=request.form.get("q", "")))

    new_quantity = item["quantity"] + delta
    if new_quantity < 0:
        flash("Quantity cannot go below zero.", "error")
    else:
        db.execute(
            """
            UPDATE items
            SET quantity = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND user_id = ?
            """,
            (new_quantity, item_id, g.user["id"]),
        )
        db.commit()
        flash("Quantity updated.", "success")

    return redirect(url_for("inventory", q=request.form.get("q", "")))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5047, debug=True)
