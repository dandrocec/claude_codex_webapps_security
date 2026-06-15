"""SQLite access layer.

Every query in the application goes through these helpers, and every value
is passed as a bound parameter (never string-formatted into SQL) to prevent
SQL injection.
"""
import sqlite3
from flask import current_app, g

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    UNIQUE NOT NULL,
    email         TEXT    UNIQUE NOT NULL,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS recipes (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    title        TEXT    NOT NULL,
    ingredients  TEXT    NOT NULL,
    steps        TEXT    NOT NULL,
    photo        TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes (user_id);
"""


def get_db() -> sqlite3.Connection:
    """Return a request-scoped database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign keys (off by default in SQLite).
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create tables if they do not yet exist."""
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()
