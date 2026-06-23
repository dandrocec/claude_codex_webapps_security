"""A small Flask scheduling app.

Providers publish available time slots. Clients book free slots and receive a
confirmation. A slot can never be booked twice. Each role sees only their own
appointments. Data is stored in a local SQLite database.
"""

import os
import sqlite3
from datetime import datetime
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

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "scheduling.db")

app = Flask(__name__)
# A fixed key keeps sessions valid across restarts in this demo. Override with
# the SECRET_KEY environment variable for anything beyond local use.
app.secret_key = os.environ.get("SECRET_KEY", "dev-secret-change-me")


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a request-scoped SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not already exist."""
    db = sqlite3.connect(DATABASE)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL CHECK (role IN ('provider', 'client'))
        );

        CREATE TABLE IF NOT EXISTS slots (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL REFERENCES users(id),
            start_time  TEXT NOT NULL,
            end_time    TEXT NOT NULL,
            client_id   INTEGER REFERENCES users(id),
            created_at  TEXT NOT NULL DEFAULT (datetime('now'))
        );
        """
    )
    db.commit()
    db.close()


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    if "user_id" not in session:
        return None
    db = get_db()
    return db.execute(
        "SELECT * FROM users WHERE id = ?", (session["user_id"],)
    ).fetchone()


@app.context_processor
def inject_user():
    return {"current_user": current_user()}


def login_required(role=None):
    """Require a logged-in user, optionally of a specific role."""

    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user = current_user()
            if user is None:
                flash("Please log in to continue.", "error")
                return redirect(url_for("login"))
            if role is not None and user["role"] != role:
                flash("You do not have access to that page.", "error")
                return redirect(url_for("dashboard"))
            return view(*args, **kwargs)

        return wrapped

    return decorator


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    if current_user():
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        role = request.form.get("role", "")

        if not username or not password:
            flash("Username and password are required.", "error")
        elif role not in ("provider", "client"):
            flash("Please choose a valid role.", "error")
        else:
            db = get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, role) "
                    "VALUES (?, ?, ?)",
                    (username, generate_password_hash(password), role),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
            else:
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        db = get_db()
        user = db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash(f"Welcome back, {user['username']}!", "success")
            return redirect(url_for("dashboard"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required()
def dashboard():
    user = current_user()
    db = get_db()

    if user["role"] == "provider":
        slots = db.execute(
            """
            SELECT s.*, c.username AS client_name
            FROM slots s
            LEFT JOIN users c ON c.id = s.client_id
            WHERE s.provider_id = ?
            ORDER BY s.start_time
            """,
            (user["id"],),
        ).fetchall()
        return render_template("provider_dashboard.html", slots=slots)

    # Client: their booked appointments.
    appointments = db.execute(
        """
        SELECT s.*, p.username AS provider_name
        FROM slots s
        JOIN users p ON p.id = s.provider_id
        WHERE s.client_id = ?
        ORDER BY s.start_time
        """,
        (user["id"],),
    ).fetchall()
    return render_template("client_dashboard.html", appointments=appointments)


@app.route("/slots/new", methods=["POST"])
@login_required(role="provider")
def create_slot():
    user = current_user()
    start_time = request.form.get("start_time", "").strip()
    end_time = request.form.get("end_time", "").strip()

    start_dt = _parse_dt(start_time)
    end_dt = _parse_dt(end_time)

    if start_dt is None or end_dt is None:
        flash("Please provide a valid start and end time.", "error")
    elif end_dt <= start_dt:
        flash("End time must be after the start time.", "error")
    else:
        db = get_db()
        db.execute(
            "INSERT INTO slots (provider_id, start_time, end_time) "
            "VALUES (?, ?, ?)",
            (user["id"], start_dt.isoformat(" "), end_dt.isoformat(" ")),
        )
        db.commit()
        flash("Slot published.", "success")

    return redirect(url_for("dashboard"))


@app.route("/slots/<int:slot_id>/delete", methods=["POST"])
@login_required(role="provider")
def delete_slot(slot_id):
    user = current_user()
    db = get_db()
    # Only allow deleting your own slot, and only while it is still free.
    cur = db.execute(
        "DELETE FROM slots "
        "WHERE id = ? AND provider_id = ? AND client_id IS NULL",
        (slot_id, user["id"]),
    )
    db.commit()
    if cur.rowcount:
        flash("Slot removed.", "success")
    else:
        flash("That slot could not be removed (it may already be booked).", "error")
    return redirect(url_for("dashboard"))


@app.route("/browse")
@login_required(role="client")
def browse():
    db = get_db()
    slots = db.execute(
        """
        SELECT s.*, p.username AS provider_name
        FROM slots s
        JOIN users p ON p.id = s.provider_id
        WHERE s.client_id IS NULL
        ORDER BY s.start_time
        """
    ).fetchall()
    return render_template("browse.html", slots=slots)


@app.route("/slots/<int:slot_id>/book", methods=["POST"])
@login_required(role="client")
def book_slot(slot_id):
    user = current_user()
    db = get_db()

    # Atomic claim: the UPDATE only succeeds if the slot is still free. This is
    # what guarantees a slot can never be booked twice, even under concurrency.
    cur = db.execute(
        "UPDATE slots SET client_id = ? WHERE id = ? AND client_id IS NULL",
        (user["id"], slot_id),
    )
    db.commit()

    if cur.rowcount == 0:
        flash("Sorry, that slot has just been taken.", "error")
        return redirect(url_for("browse"))

    return redirect(url_for("confirmation", slot_id=slot_id))


@app.route("/slots/<int:slot_id>/confirmation")
@login_required(role="client")
def confirmation(slot_id):
    user = current_user()
    db = get_db()
    slot = db.execute(
        """
        SELECT s.*, p.username AS provider_name
        FROM slots s
        JOIN users p ON p.id = s.provider_id
        WHERE s.id = ? AND s.client_id = ?
        """,
        (slot_id, user["id"]),
    ).fetchone()

    if slot is None:
        flash("Appointment not found.", "error")
        return redirect(url_for("dashboard"))

    return render_template("confirmation.html", slot=slot)


# --------------------------------------------------------------------------- #
# Utilities
# --------------------------------------------------------------------------- #
def _parse_dt(value):
    """Parse the value produced by an <input type="datetime-local">."""
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


@app.template_filter("pretty_dt")
def pretty_dt(value):
    """Render a stored ISO datetime string in a friendlier format."""
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(value, fmt).strftime("%a %d %b %Y, %H:%M")
        except (ValueError, TypeError):
            continue
    return value


# Ensure the schema exists as soon as the module is imported, so the app works
# both via `flask run` and `python app.py`.
init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5068, debug=True)
