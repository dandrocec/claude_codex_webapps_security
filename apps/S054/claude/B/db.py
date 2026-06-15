"""SQLite access layer.

Every query uses parameter binding (the DB-API ``?`` placeholder) so user
input is never concatenated into SQL — this is the primary defence against
SQL injection.
"""
import sqlite3
from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS entries (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL,
    project   TEXT NOT NULL,
    entry_date TEXT NOT NULL,          -- ISO 8601 (YYYY-MM-DD)
    hours     REAL NOT NULL,
    note      TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_entries_user_date
    ON entries(user_id, entry_date);
"""


def get_db() -> sqlite3.Connection:
    """Return a request-scoped SQLite connection."""
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"])
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def close_db(exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()
