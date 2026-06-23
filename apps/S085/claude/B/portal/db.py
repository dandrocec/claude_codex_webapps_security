"""SQLite helpers.

A single connection per request is stored on ``flask.g``. Every query in the
application uses parameter substitution (``?`` placeholders) so user input is
never concatenated into SQL.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import click
from flask import Flask, current_app, g


def get_db() -> sqlite3.Connection:
    """Return the request-scoped database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign keys (off by default in SQLite).
        g.db.execute("PRAGMA foreign_keys = ON;")
    return g.db


def close_db(exception: BaseException | None = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    db = get_db()
    schema = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")
    db.executescript(schema)
    db.commit()


@click.command("init-db")
def init_db_command() -> None:
    """Create database tables (``flask --app run init-db``)."""
    init_db()
    click.echo("Initialised the database.")


def init_app(app: Flask) -> None:
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
