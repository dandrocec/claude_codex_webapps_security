"""Database engine and session setup.

We use SQLAlchemy's ORM. All queries go through the ORM / bound parameters,
so user input is always sent as parameters and never string-concatenated into
SQL. This prevents SQL injection (OWASP A03).
"""
from __future__ import annotations

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from .config import settings

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    # Allow the SQLite connection to be used across the worker threads that
    # run jobs.
    connect_args = {"check_same_thread": False}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)

Base = declarative_base()


def init_db() -> None:
    from . import models  # noqa: F401  (ensure models are registered)

    Base.metadata.create_all(bind=engine)
