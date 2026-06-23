"""Database helpers.

A thin wrapper around sqlite3. Every query in the application is executed
through these helpers using parameter substitution (``?`` placeholders), so
user-supplied values are never concatenated into SQL strings. This is the
primary defence against SQL injection (OWASP A03).
"""

import os
import sqlite3

# Resolve the database path relative to this file so the app can be started
# from any working directory.
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "shop.db"))
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")


def get_connection():
    """Return a new SQLite connection with sane, safe defaults."""
    conn = sqlite3.connect(DB_PATH)
    # Return rows that behave like dicts for readable, explicit access.
    conn.row_factory = sqlite3.Row
    # Enforce foreign key constraints (off by default in SQLite).
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def query_all(sql, params=()):
    """Run a SELECT and return all rows."""
    conn = get_connection()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def query_one(sql, params=()):
    """Run a SELECT and return the first row (or None)."""
    conn = get_connection()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def execute(sql, params=()):
    """Run an INSERT/UPDATE/DELETE and return the last row id."""
    conn = get_connection()
    try:
        cur = conn.execute(sql, params)
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


def init_db():
    """Create tables from schema.sql if they do not already exist."""
    conn = get_connection()
    try:
        with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
            conn.executescript(fh.read())
        conn.commit()
    finally:
        conn.close()
