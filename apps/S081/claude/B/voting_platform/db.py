"""SQLite access helpers.

Every query in this module (and in app.py) uses parameter substitution
(``?`` placeholders) so user input is never concatenated into SQL — this is
our primary defence against SQL injection.
"""
import os
import sqlite3
from flask import g, current_app

# Database file lives next to this module unless overridden by the environment.
DB_PATH = os.environ.get(
    "DATABASE_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "voting.db"),
)


def get_db():
    """Return a per-request SQLite connection (cached on flask.g)."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        # Enforce foreign keys for every connection.
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables from schema.sql (idempotent)."""
    schema_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")
    db = sqlite3.connect(DB_PATH)
    try:
        with open(schema_path, "r", encoding="utf-8") as f:
            db.executescript(f.read())
        db.commit()
    finally:
        db.close()


def init_app(app):
    """Register teardown handler so connections are always closed."""
    app.teardown_appcontext(close_db)
