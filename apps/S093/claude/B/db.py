"""SQLite access layer.

All queries use parameter binding (never string formatting) to prevent SQL
injection. The connection is opened per-request and closed at teardown.
"""

import os
import sqlite3

from flask import g

DB_PATH = os.environ.get(
    "LEDGER_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "ledger.db"),
)
SCHEMA_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "schema.sql")


def get_db():
    """Return the request-scoped database connection, opening it if needed."""
    if "db" not in g:
        # isolation_level=None puts the driver in autocommit mode so we can
        # manage transaction boundaries explicitly with BEGIN IMMEDIATE.
        conn = sqlite3.connect(DB_PATH, isolation_level=None)
        conn.row_factory = sqlite3.Row
        # Enforce foreign keys and use a sensible busy timeout so concurrent
        # writers wait for the lock instead of failing immediately.
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        g.db = conn
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    """Create tables from schema.sql if they do not already exist."""
    conn = sqlite3.connect(DB_PATH)
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
            conn.executescript(fh.read())
        conn.commit()
    finally:
        conn.close()


def init_app(app):
    app.teardown_appcontext(close_db)
