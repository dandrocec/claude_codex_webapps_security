"""SQLite access layer.

Every query in the app uses parameterised statements (the `?` placeholder)
so user input is never concatenated into SQL — this is our primary defence
against SQL injection.
"""
import sqlite3

import click
from flask import current_app, g


def get_db() -> sqlite3.Connection:
    """Return a request-scoped database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign keys for every connection.
        g.db.execute("PRAGMA foreign_keys = ON;")
    return g.db


def close_db(exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create tables from schema.sql (idempotent)."""
    db = get_db()
    with current_app.open_resource("schema.sql") as f:
        db.executescript(f.read().decode("utf-8"))
    db.commit()


@click.command("init-db")
def init_db_command() -> None:
    """Flask CLI command: `flask init-db`."""
    init_db()
    click.echo("Initialised the database.")


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
