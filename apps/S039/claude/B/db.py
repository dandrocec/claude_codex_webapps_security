"""SQLite access helpers.

All queries in the application go through this module and use parameter
binding (the ``?`` placeholder) so that user-supplied values are never
concatenated into SQL strings -- this is the primary defence against SQL
injection.
"""
import sqlite3
from pathlib import Path

from flask import current_app, g

SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"


def get_db() -> sqlite3.Connection:
    """Return a request-scoped database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign-key constraints (off by default in SQLite).
        g.db.execute("PRAGMA foreign_keys = ON;")
    return g.db


def close_db(exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create the database schema if it does not yet exist."""
    db = get_db()
    db.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()
