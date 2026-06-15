"""SQLite access layer. All queries use parameter binding (no string interpolation)."""
from __future__ import annotations

import sqlite3

import click
from flask import Flask, current_app, g


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign-key constraints (off by default in SQLite).
        g.db.execute("PRAGMA foreign_keys = ON;")
    return g.db


def close_db(exception=None) -> None:  # noqa: ARG001
    db = g.pop("db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS items (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL,
    name                TEXT NOT NULL,
    sku                 TEXT NOT NULL,
    quantity            INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    location            TEXT NOT NULL DEFAULT '',
    low_stock_threshold INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_threshold >= 0),
    created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    UNIQUE (user_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_items_user ON items (user_id);
"""


def init_db() -> None:
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


@click.command("init-db")
def init_db_command() -> None:
    """Create database tables."""
    init_db()
    click.echo("Initialised the database.")


def init_app_db(app: Flask) -> None:
    app.cli.add_command(init_db_command)
    # Ensure the schema exists on startup so the app is runnable out of the box.
    with app.app_context():
        init_db()
