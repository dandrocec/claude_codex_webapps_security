"""SQLite data-access layer.

Every query uses parameterised statements (``?`` placeholders) so that user
input can never be interpreted as SQL (OWASP A03: Injection).
"""
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT    NOT NULL UNIQUE,
    display_name  TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    tier          TEXT    NOT NULL DEFAULT 'free'
                          CHECK (tier IN ('free', 'premium')),
    is_admin      INTEGER NOT NULL DEFAULT 0
                          CHECK (is_admin IN (0, 1)),
    created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
"""


def get_db() -> sqlite3.Connection:
    """Return a request-scoped database connection."""
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"])
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create tables if they do not already exist."""
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)


# --- User queries (all parameterised) -------------------------------------

def get_user_by_email(email: str):
    return get_db().execute(
        "SELECT * FROM users WHERE email = ?", (email,)
    ).fetchone()


def get_user_by_id(user_id: int):
    return get_db().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def list_users():
    return get_db().execute(
        "SELECT id, email, display_name, tier, is_admin, created_at "
        "FROM users ORDER BY created_at DESC"
    ).fetchall()


def create_user(email: str, display_name: str, password_hash: str,
                tier: str = "free", is_admin: int = 0) -> int:
    db = get_db()
    cur = db.execute(
        "INSERT INTO users (email, display_name, password_hash, tier, "
        "is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (email, display_name, password_hash, tier, is_admin,
         datetime.now(timezone.utc).isoformat()),
    )
    db.commit()
    return cur.lastrowid


def set_user_tier(user_id: int, tier: str) -> None:
    db = get_db()
    db.execute("UPDATE users SET tier = ? WHERE id = ?", (tier, user_id))
    db.commit()


def update_display_name(user_id: int, display_name: str) -> None:
    db = get_db()
    db.execute(
        "UPDATE users SET display_name = ? WHERE id = ?",
        (display_name, user_id),
    )
    db.commit()


def count_users() -> int:
    return get_db().execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
