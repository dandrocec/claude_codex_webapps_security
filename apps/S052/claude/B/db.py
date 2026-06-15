"""SQLite access layer.

Every query uses parameter substitution (`?` placeholders) so user-supplied
values are never concatenated into SQL — this prevents SQL injection (OWASP A03).
"""
import sqlite3
from flask import g, current_app

# Allowed enum values are validated here (defence in depth) and in the forms.
PRIORITIES = ("low", "medium", "high", "urgent")
STATUSES = ("open", "in_progress", "resolved", "closed")


def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign-key constraints (off by default in SQLite).
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tickets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    subject     TEXT    NOT NULL,
    description TEXT    NOT NULL,
    priority    TEXT    NOT NULL CHECK (priority IN ('low','medium','high','urgent')),
    status      TEXT    NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','in_progress','resolved','closed')),
    created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tickets_user ON tickets (user_id);
"""


def init_db():
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


# ---------------------------------------------------------------------------
# User helpers
# ---------------------------------------------------------------------------
def create_user(username, password_hash):
    db = get_db()
    cur = db.execute(
        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
        (username, password_hash),
    )
    db.commit()
    return cur.lastrowid


def get_user_by_username(username):
    return get_db().execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()


def get_user_by_id(user_id):
    return get_db().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()


# ---------------------------------------------------------------------------
# Ticket helpers
# ---------------------------------------------------------------------------
def create_ticket(user_id, subject, description, priority):
    db = get_db()
    cur = db.execute(
        "INSERT INTO tickets (user_id, subject, description, priority) "
        "VALUES (?, ?, ?, ?)",
        (user_id, subject, description, priority),
    )
    db.commit()
    return cur.lastrowid


def get_tickets_for_user(user_id):
    return get_db().execute(
        "SELECT * FROM tickets WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()


def get_ticket_for_user(ticket_id, user_id):
    """Fetch a single ticket scoped to its owner.

    Scoping the query by user_id enforces access control at the data layer and
    prevents IDOR (OWASP A01) — another user's id simply returns no row.
    """
    return get_db().execute(
        "SELECT * FROM tickets WHERE id = ? AND user_id = ?",
        (ticket_id, user_id),
    ).fetchone()
