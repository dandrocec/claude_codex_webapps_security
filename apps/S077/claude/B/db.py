"""SQLite access layer.

Every query in the application goes through here and uses parameter
binding (``?`` placeholders) so that user input is never concatenated
into SQL text. This is the primary defence against SQL injection.
"""

import os
import sqlite3
from flask import g

DB_PATH = os.environ.get(
    "WIKI_DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "wiki.db"),
)
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


def get_db():
    """Return a request-scoped SQLite connection."""
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables from schema.sql if they do not yet exist."""
    conn = sqlite3.connect(DB_PATH)
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
            conn.executescript(fh.read())
        conn.commit()
    finally:
        conn.close()


def init_app(app):
    app.teardown_appcontext(close_db)
