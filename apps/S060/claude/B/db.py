"""SQLite access layer.

Every query in the application goes through helpers here and uses
parameterised statements (``?`` placeholders). User-supplied values are
never concatenated into SQL strings, which prevents SQL injection.
"""
import sqlite3
from typing import Any, Optional

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
        # Enforce foreign-key constraints on every connection.
        g.db.execute("PRAGMA foreign_keys = ON;")
    return g.db


def close_db(exc: Optional[BaseException] = None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_db(query: str, args: tuple = (), one: bool = False):
    """Run a parameterised SELECT and return rows."""
    cur = get_db().execute(query, args)
    rows = cur.fetchall()
    cur.close()
    return (rows[0] if rows else None) if one else rows


def execute_db(query: str, args: tuple = ()) -> int:
    """Run a parameterised INSERT/UPDATE/DELETE and commit. Returns lastrowid."""
    db = get_db()
    cur = db.execute(query, args)
    db.commit()
    last_id = cur.lastrowid
    cur.close()
    return last_id


def init_db() -> None:
    """Create tables from schema.sql."""
    db = get_db()
    with current_app.open_resource("schema.sql") as f:
        db.executescript(f.read().decode("utf-8"))


@click.command("init-db")
def init_db_command() -> None:
    """flask init-db — (re)create the database tables."""
    init_db()
    click.echo("Initialised the database.")


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
