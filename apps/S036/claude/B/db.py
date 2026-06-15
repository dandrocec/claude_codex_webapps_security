"""SQLite access helpers.

All queries use parameter substitution (``?`` placeholders) so user input is
never concatenated into SQL strings — this prevents SQL injection.
"""
import sqlite3
from flask import current_app, g


def get_db() -> sqlite3.Connection:
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE_PATH"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign key constraints.
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exception=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create tables from schema.sql if they do not yet exist."""
    db = get_db()
    with current_app.open_resource("schema.sql") as f:
        db.executescript(f.read().decode("utf-8"))
    db.commit()


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    with app.app_context():
        init_db()
