"""SQLite access helpers.

Every query in the application uses bound parameters (the `?` placeholder
form) — string interpolation is never used to build SQL, which prevents
SQL injection.
"""
import sqlite3
from flask import current_app, g


def get_db() -> sqlite3.Connection:
    """Return a per-request SQLite connection."""
    if "db" not in g:
        conn = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        conn.row_factory = sqlite3.Row
        # Enforce foreign-key constraints (off by default in SQLite).
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def close_db(exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create tables from schema.sql if they do not already exist."""
    import os

    db = get_db()
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    with open(schema_path, "r", encoding="utf-8") as fh:
        db.executescript(fh.read())
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
