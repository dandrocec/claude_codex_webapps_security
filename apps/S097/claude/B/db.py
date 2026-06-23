"""SQLite access helpers.

Every query in the app uses parameter binding (the `?` placeholder) so user
input is never concatenated into SQL — this prevents SQL injection.
"""
import os
import sqlite3

import click
from flask import current_app, g


def get_db() -> sqlite3.Connection:
    """Return a request-scoped database connection."""
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DATABASE"],
            detect_types=sqlite3.PARSE_DECLTYPES,
            # Autocommit mode: each statement commits immediately unless we open
            # an explicit transaction (BEGIN ... COMMIT), as checkout does. This
            # gives predictable transaction control across Python versions.
            isolation_level=None,
        )
        g.db.row_factory = sqlite3.Row
        # Enforce foreign keys for every connection.
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create all tables (drops existing ones first)."""
    db = get_db()
    with current_app.open_resource("schema.sql") as f:
        db.executescript(f.read().decode("utf8"))
    db.commit()


@click.command("init-db")
def init_db_command() -> None:
    """flask --app app init-db"""
    init_db()
    click.echo("Initialised the database.")


@click.command("seed")
def seed_command() -> None:
    """flask --app app seed"""
    from seed import seed_data

    seed_data()
    click.echo("Seeded sample data.")


def init_app(app) -> None:
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    app.cli.add_command(seed_command)


def database_exists(app) -> bool:
    path = app.config["DATABASE"]
    return os.path.exists(path) and os.path.getsize(path) > 0
