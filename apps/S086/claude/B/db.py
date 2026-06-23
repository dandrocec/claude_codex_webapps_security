"""Thin SQLite data-access layer.

Every query uses parameter binding (``?`` placeholders) — no string
interpolation of user input is ever performed, which eliminates SQL injection.
"""
import sqlite3
from datetime import datetime, timezone

from flask import current_app, g


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    email         TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    is_active     INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT    NOT NULL,
    last_login    TEXT
);
"""


def init_db() -> None:
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --- User queries (all parameterised) --------------------------------------

def get_user_by_username(username: str):
    return get_db().execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    ).fetchone()


def get_user_by_id(user_id: int):
    return get_db().execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()


def list_users():
    return get_db().execute(
        "SELECT * FROM users ORDER BY created_at DESC, id DESC"
    ).fetchall()


def create_user(username, email, password_hash, is_admin, is_active=1):
    db = get_db()
    cur = db.execute(
        """INSERT INTO users (username, email, password_hash, is_admin,
                              is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (username, email, password_hash, int(is_admin), int(is_active), now_iso()),
    )
    db.commit()
    return cur.lastrowid


def update_user(user_id, username, email, is_admin, is_active):
    db = get_db()
    db.execute(
        """UPDATE users
              SET username = ?, email = ?, is_admin = ?, is_active = ?
            WHERE id = ?""",
        (username, email, int(is_admin), int(is_active), user_id),
    )
    db.commit()


def update_password(user_id, password_hash):
    db = get_db()
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?",
        (password_hash, user_id),
    )
    db.commit()


def set_active(user_id, is_active):
    db = get_db()
    db.execute(
        "UPDATE users SET is_active = ? WHERE id = ?",
        (int(is_active), user_id),
    )
    db.commit()


def touch_last_login(user_id):
    db = get_db()
    db.execute(
        "UPDATE users SET last_login = ? WHERE id = ?", (now_iso(), user_id)
    )
    db.commit()


def stats():
    db = get_db()
    row = db.execute(
        """SELECT
              COUNT(*)                                   AS total,
              COALESCE(SUM(is_active), 0)                AS active,
              COALESCE(SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END), 0) AS inactive,
              COALESCE(SUM(is_admin), 0)                 AS admins
           FROM users"""
    ).fetchone()
    return dict(row)
