import os
import re
import secrets
import sqlite3
from functools import wraps
from pathlib import Path

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
from flask_wtf import CSRFProtect


BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("DATABASE_URL", BASE_DIR / "inventory.sqlite3"))

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")
SKU_RE = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
LOCATION_RE = re.compile(r"^[A-Za-z0-9 ,_.#/-]{0,80}$")
MAX_NAME_LEN = 120
LOW_STOCK_THRESHOLD = int(os.environ.get("LOW_STOCK_THRESHOLD", "5"))


app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", secrets.token_urlsafe(32)),
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
    == "true",
    SESSION_COOKIE_SAMESITE="Lax",
    WTF_CSRF_TIME_LIMIT=3600,
    MAX_CONTENT_LENGTH=64 * 1024,
)

bcrypt = Bcrypt(app)
csrf = CSRFProtect(app)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sku TEXT NOT NULL,
            quantity INTEGER NOT NULL CHECK (quantity >= 0),
            location TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
            UNIQUE (user_id, sku)
        );

        CREATE INDEX IF NOT EXISTS idx_items_user_search
        ON items (user_id, name, sku, location);
        """
    )
    db.commit()


@app.before_request
def load_logged_in_user():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        ).fetchone()


@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "script-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Cache-Control"] = "no-store"
    return response


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def clean_text(value):
    return " ".join((value or "").strip().split())


def validate_username(username):
    username = clean_text(username)
    if not USERNAME_RE.fullmatch(username):
        return None, "Username must be 3-40 characters using letters, numbers, dot, dash, or underscore."
    return username, None


def validate_password(password):
    if len(password or "") < 12:
        return "Password must be at least 12 characters."
    if len(password) > 256:
        return "Password is too long."
    return None


def validate_item_form(form):
    errors = []
    name = clean_text(form.get("name"))
    sku = clean_text(form.get("sku")).upper()
    location = clean_text(form.get("location"))

    if not name or len(name) > MAX_NAME_LEN:
        errors.append("Name is required and must be 120 characters or fewer.")
    if not SKU_RE.fullmatch(sku):
        errors.append("SKU may contain only letters, numbers, dot, dash, and underscore.")
    if not LOCATION_RE.fullmatch(location):
        errors.append("Location contains unsupported characters.")

    try:
        quantity = int(form.get("quantity", ""))
    except ValueError:
        errors.append("Quantity must be a whole number.")
        quantity = 0

    if quantity < 0 or quantity > 1_000_000:
        errors.append("Quantity must be between 0 and 1,000,000.")

    return {"name": name, "sku": sku, "quantity": quantity, "location": location}, errors


def parse_adjustment(form):
    try:
        delta = int(form.get("delta", ""))
    except ValueError:
        return None, "Adjustment must be a whole number."
    if delta < -1_000_000 or delta > 1_000_000:
        return None, "Adjustment is outside the allowed range."
    return delta, None


@app.route("/")
@login_required
def index():
    query = clean_text(request.args.get("q", ""))[:80]
    params = [g.user["id"]]
    sql = (
        "SELECT id, name, sku, quantity, location, updated_at FROM items "
        "WHERE user_id = ?"
    )
    if query:
        sql += " AND (name LIKE ? OR sku LIKE ? OR location LIKE ?)"
        like = f"%{query}%"
        params.extend([like, like, like])
    sql += " ORDER BY name COLLATE NOCASE"
    items = get_db().execute(sql, params).fetchall()
    return render_template(
        "index.html",
        items=items,
        query=query,
        low_stock_threshold=LOW_STOCK_THRESHOLD,
    )


@app.route("/register", methods=("GET", "POST"))
def register():
    if g.user:
        return redirect(url_for("index"))
    if request.method == "POST":
        username, username_error = validate_username(request.form.get("username"))
        password = request.form.get("password", "")
        password_error = validate_password(password)
        error = username_error or password_error

        if error is None:
            password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
            try:
                get_db().execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, password_hash),
                )
                get_db().commit()
            except sqlite3.IntegrityError:
                error = "That username is already registered."
            else:
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))

        flash(error, "error")
    return render_template("auth.html", mode="register")


@app.route("/login", methods=("GET", "POST"))
def login():
    if g.user:
        return redirect(url_for("index"))
    if request.method == "POST":
        username = clean_text(request.form.get("username"))
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if user is None or not bcrypt.check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash("Signed in.", "success")
            return redirect(url_for("index"))
    return render_template("auth.html", mode="login")


@app.post("/logout")
@login_required
def logout():
    session.clear()
    flash("Signed out.", "success")
    return redirect(url_for("login"))


@app.route("/items/new", methods=("GET", "POST"))
@login_required
def new_item():
    if request.method == "POST":
        item, errors = validate_item_form(request.form)
        if not errors:
            try:
                get_db().execute(
                    """
                    INSERT INTO items (user_id, name, sku, quantity, location)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        g.user["id"],
                        item["name"],
                        item["sku"],
                        item["quantity"],
                        item["location"],
                    ),
                )
                get_db().commit()
                flash("Item added.", "success")
                return redirect(url_for("index"))
            except sqlite3.IntegrityError:
                errors.append("An item with that SKU already exists.")
        for error in errors:
            flash(error, "error")
    return render_template("item_form.html", item=None)


@app.route("/items/<int:item_id>/edit", methods=("GET", "POST"))
@login_required
def edit_item(item_id):
    db = get_db()
    item = db.execute(
        "SELECT id, name, sku, quantity, location FROM items WHERE id = ? AND user_id = ?",
        (item_id, g.user["id"]),
    ).fetchone()
    if item is None:
        abort(404)

    if request.method == "POST":
        updated, errors = validate_item_form(request.form)
        if not errors:
            try:
                db.execute(
                    """
                    UPDATE items
                    SET name = ?, sku = ?, quantity = ?, location = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        updated["name"],
                        updated["sku"],
                        updated["quantity"],
                        updated["location"],
                        item_id,
                        g.user["id"],
                    ),
                )
                db.commit()
                flash("Item updated.", "success")
                return redirect(url_for("index"))
            except sqlite3.IntegrityError:
                errors.append("An item with that SKU already exists.")
        for error in errors:
            flash(error, "error")
    return render_template("item_form.html", item=item)


@app.post("/items/<int:item_id>/adjust")
@login_required
def adjust_item(item_id):
    delta, error = parse_adjustment(request.form)
    if error:
        flash(error, "error")
        return redirect(url_for("index"))

    db = get_db()
    item = db.execute(
        "SELECT id, quantity FROM items WHERE id = ? AND user_id = ?",
        (item_id, g.user["id"]),
    ).fetchone()
    if item is None:
        abort(404)

    new_quantity = item["quantity"] + delta
    if new_quantity < 0 or new_quantity > 1_000_000:
        flash("Quantity adjustment would leave the allowed range.", "error")
        return redirect(url_for("index"))

    db.execute(
        """
        UPDATE items
        SET quantity = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
        """,
        (new_quantity, item_id, g.user["id"]),
    )
    db.commit()
    flash("Quantity adjusted.", "success")
    return redirect(url_for("index"))


@app.post("/items/<int:item_id>/delete")
@login_required
def delete_item(item_id):
    db = get_db()
    result = db.execute(
        "DELETE FROM items WHERE id = ? AND user_id = ?", (item_id, g.user["id"])
    )
    db.commit()
    if result.rowcount == 0:
        abort(404)
    flash("Item deleted.", "success")
    return redirect(url_for("index"))


@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(500)
def handle_error(error):
    code = getattr(error, "code", 500)
    if code == 500:
        app.logger.exception("Unhandled server error")
    message = {
        400: "Bad request.",
        403: "Forbidden.",
        404: "Not found.",
        413: "Request too large.",
    }.get(code, "An internal error occurred.")
    return render_template("error.html", code=code, message=message), code


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5047)
