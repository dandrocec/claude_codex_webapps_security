"""A small Flask helpdesk.

Customers open tickets and add replies; agents see every ticket, assign
them, change status, and reply. Customers only ever see their own tickets.
Data lives in a local SQLite database.

Run with:  python app.py   (serves on http://127.0.0.1:5062)
"""
import functools
import os
import sqlite3
from datetime import datetime

from flask import (
    Flask, flash, g, redirect, render_template, request, session, url_for, abort,
)
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "helpdesk.db")

STATUSES = ("open", "pending", "resolved", "closed")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables (if needed) and seed a couple of demo accounts."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            username    TEXT UNIQUE NOT NULL,
            password    TEXT NOT NULL,
            role        TEXT NOT NULL CHECK (role IN ('customer', 'agent'))
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            subject     TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'open',
            customer_id INTEGER NOT NULL REFERENCES users(id),
            agent_id    INTEGER REFERENCES users(id),
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS replies (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ticket_id   INTEGER NOT NULL REFERENCES tickets(id),
            author_id   INTEGER NOT NULL REFERENCES users(id),
            body        TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        """
    )
    db.commit()

    # Seed demo users only the first time around.
    if db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"] == 0:
        demo = [
            ("alice", "password", "customer"),
            ("bob", "password", "customer"),
            ("agent", "password", "agent"),
        ]
        db.executemany(
            "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
            [(u, generate_password_hash(p), r) for u, p, r in demo],
        )
        db.commit()
    db.close()


def now():
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M")


# --------------------------------------------------------------------------- #
# Authentication
# --------------------------------------------------------------------------- #
@app.before_request
def load_logged_in_user():
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in first.")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def agent_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        if g.user["role"] != "agent":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        error = None
        if not username or not password:
            error = "Username and password are required."
        elif db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        ).fetchone():
            error = f"User '{username}' already exists."

        if error is None:
            db.execute(
                "INSERT INTO users (username, password, role) VALUES (?, ?, 'customer')",
                (username, generate_password_hash(password)),
            )
            db.commit()
            flash("Account created — please log in.")
            return redirect(url_for("login"))
        flash(error)
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user is None or not check_password_hash(user["password"], password):
            flash("Invalid username or password.")
        else:
            session.clear()
            session["user_id"] = user["id"]
            return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# --------------------------------------------------------------------------- #
# Tickets
# --------------------------------------------------------------------------- #
@app.route("/")
@login_required
def index():
    db = get_db()
    if g.user["role"] == "agent":
        tickets = db.execute(
            """
            SELECT t.*, c.username AS customer, a.username AS agent
            FROM tickets t
            JOIN users c ON c.id = t.customer_id
            LEFT JOIN users a ON a.id = t.agent_id
            ORDER BY t.updated_at DESC
            """
        ).fetchall()
    else:
        tickets = db.execute(
            """
            SELECT t.*, c.username AS customer, a.username AS agent
            FROM tickets t
            JOIN users c ON c.id = t.customer_id
            LEFT JOIN users a ON a.id = t.agent_id
            WHERE t.customer_id = ?
            ORDER BY t.updated_at DESC
            """,
            (g.user["id"],),
        ).fetchall()
    return render_template("index.html", tickets=tickets)


@app.route("/tickets/new", methods=["GET", "POST"])
@login_required
def new_ticket():
    if g.user["role"] != "customer":
        # Agents respond to tickets; they don't open them.
        flash("Only customers can open tickets.")
        return redirect(url_for("index"))
    if request.method == "POST":
        subject = request.form.get("subject", "").strip()
        body = request.form.get("body", "").strip()
        if not subject or not body:
            flash("Subject and message are both required.")
        else:
            db = get_db()
            ts = now()
            cur = db.execute(
                """
                INSERT INTO tickets (subject, status, customer_id, created_at, updated_at)
                VALUES (?, 'open', ?, ?, ?)
                """,
                (subject, g.user["id"], ts, ts),
            )
            db.execute(
                "INSERT INTO replies (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)",
                (cur.lastrowid, g.user["id"], body, ts),
            )
            db.commit()
            return redirect(url_for("view_ticket", ticket_id=cur.lastrowid))
    return render_template("new_ticket.html")


def get_ticket_or_404(ticket_id):
    db = get_db()
    ticket = db.execute(
        """
        SELECT t.*, c.username AS customer, a.username AS agent
        FROM tickets t
        JOIN users c ON c.id = t.customer_id
        LEFT JOIN users a ON a.id = t.agent_id
        WHERE t.id = ?
        """,
        (ticket_id,),
    ).fetchone()
    if ticket is None:
        abort(404)
    # Customers may only touch their own tickets.
    if g.user["role"] != "agent" and ticket["customer_id"] != g.user["id"]:
        abort(403)
    return ticket


@app.route("/tickets/<int:ticket_id>")
@login_required
def view_ticket(ticket_id):
    ticket = get_ticket_or_404(ticket_id)
    replies = get_db().execute(
        """
        SELECT r.*, u.username AS author, u.role AS author_role
        FROM replies r
        JOIN users u ON u.id = r.author_id
        WHERE r.ticket_id = ?
        ORDER BY r.created_at, r.id
        """,
        (ticket_id,),
    ).fetchall()
    agents = []
    if g.user["role"] == "agent":
        agents = get_db().execute(
            "SELECT id, username FROM users WHERE role = 'agent' ORDER BY username"
        ).fetchall()
    return render_template(
        "ticket.html", ticket=ticket, replies=replies, agents=agents, statuses=STATUSES
    )


@app.route("/tickets/<int:ticket_id>/reply", methods=["POST"])
@login_required
def add_reply(ticket_id):
    ticket = get_ticket_or_404(ticket_id)
    body = request.form.get("body", "").strip()
    if not body:
        flash("Reply cannot be empty.")
        return redirect(url_for("view_ticket", ticket_id=ticket_id))
    db = get_db()
    ts = now()
    db.execute(
        "INSERT INTO replies (ticket_id, author_id, body, created_at) VALUES (?, ?, ?, ?)",
        (ticket_id, g.user["id"], body, ts),
    )
    # A customer reply on a resolved/closed ticket reopens it.
    if g.user["role"] == "customer" and ticket["status"] in ("resolved", "closed"):
        db.execute("UPDATE tickets SET status = 'open' WHERE id = ?", (ticket_id,))
    db.execute("UPDATE tickets SET updated_at = ? WHERE id = ?", (ts, ticket_id))
    db.commit()
    return redirect(url_for("view_ticket", ticket_id=ticket_id))


@app.route("/tickets/<int:ticket_id>/status", methods=["POST"])
@agent_required
def change_status(ticket_id):
    get_ticket_or_404(ticket_id)
    status = request.form.get("status", "")
    if status not in STATUSES:
        flash("Unknown status.")
        return redirect(url_for("view_ticket", ticket_id=ticket_id))
    db = get_db()
    db.execute(
        "UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?",
        (status, now(), ticket_id),
    )
    db.commit()
    flash(f"Status changed to {status}.")
    return redirect(url_for("view_ticket", ticket_id=ticket_id))


@app.route("/tickets/<int:ticket_id>/assign", methods=["POST"])
@agent_required
def assign_ticket(ticket_id):
    get_ticket_or_404(ticket_id)
    raw = request.form.get("agent_id", "")
    agent_id = None
    if raw:
        agent = get_db().execute(
            "SELECT id FROM users WHERE id = ? AND role = 'agent'", (raw,)
        ).fetchone()
        if agent is None:
            flash("That agent does not exist.")
            return redirect(url_for("view_ticket", ticket_id=ticket_id))
        agent_id = agent["id"]
    db = get_db()
    db.execute(
        "UPDATE tickets SET agent_id = ?, updated_at = ? WHERE id = ?",
        (agent_id, now(), ticket_id),
    )
    db.commit()
    flash("Assignment updated." if agent_id else "Ticket unassigned.")
    return redirect(url_for("view_ticket", ticket_id=ticket_id))


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5062, debug=True)
