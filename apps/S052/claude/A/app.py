"""A small Flask support-ticket application.

Logged-in users can submit support tickets (subject, description, priority)
and view the status of the tickets they have created. Data is stored in a
local SQLite database.

Run with:  python app.py   (serves on http://127.0.0.1:5052)
"""

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

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "tickets.db")

PRIORITIES = ("Low", "Medium", "High", "Urgent")
STATUSES = ("Open", "In Progress", "Resolved", "Closed")

app = Flask(__name__)
# In production load this from the environment instead of hard-coding it.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = DATABASE


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
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not already exist."""
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    UNIQUE NOT NULL,
            password_hash TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            subject     TEXT    NOT NULL,
            description TEXT    NOT NULL,
            priority    TEXT    NOT NULL,
            status      TEXT    NOT NULL DEFAULT 'Open',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users (id)
        );
        """
    )
    db.commit()


# --------------------------------------------------------------------------- #
# Authentication helpers
# --------------------------------------------------------------------------- #
def current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    return get_db().execute(
        "SELECT id, username FROM users WHERE id = ?", (user_id,)
    ).fetchone()


@app.context_processor
def inject_user():
    return {"current_user": current_user()}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get("user_id") is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    if session.get("user_id"):
        return redirect(url_for("tickets"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        error = None
        if not username:
            error = "Username is required."
        elif not password:
            error = "Password is required."

        if error is None:
            db = get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                error = f"Username '{username}' is already taken."
            else:
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))

        flash(error, "error")

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
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
            flash(f"Welcome back, {user['username']}!", "success")
            next_url = request.args.get("next")
            return redirect(next_url or url_for("tickets"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("login"))


@app.route("/tickets")
@login_required
def tickets():
    rows = get_db().execute(
        "SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC, id DESC",
        (session["user_id"],),
    ).fetchall()
    return render_template("tickets.html", tickets=rows)


@app.route("/tickets/new", methods=["GET", "POST"])
@login_required
def new_ticket():
    if request.method == "POST":
        subject = request.form.get("subject", "").strip()
        description = request.form.get("description", "").strip()
        priority = request.form.get("priority", "")

        error = None
        if not subject:
            error = "Subject is required."
        elif not description:
            error = "Description is required."
        elif priority not in PRIORITIES:
            error = "Please choose a valid priority."

        if error is None:
            db = get_db()
            db.execute(
                "INSERT INTO tickets (user_id, subject, description, priority) "
                "VALUES (?, ?, ?, ?)",
                (session["user_id"], subject, description, priority),
            )
            db.commit()
            flash("Ticket submitted.", "success")
            return redirect(url_for("tickets"))

        flash(error, "error")

    return render_template("new_ticket.html", priorities=PRIORITIES)


@app.route("/tickets/<int:ticket_id>")
@login_required
def ticket_detail(ticket_id):
    ticket = get_db().execute(
        "SELECT * FROM tickets WHERE id = ? AND user_id = ?",
        (ticket_id, session["user_id"]),
    ).fetchone()
    if ticket is None:
        flash("Ticket not found.", "error")
        return redirect(url_for("tickets"))
    return render_template("ticket_detail.html", ticket=ticket)


# Ensure the database exists as soon as the module is imported so the app works
# both via `python app.py` and `flask run`.
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5052, debug=True)
