"""SQLite access layer.

All queries use parameter binding (the sqlite3 driver's ``?`` placeholders) so
user input is never concatenated into SQL — this prevents SQL injection.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator, Optional

from . import config


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(config.DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    config.DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS files (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id      INTEGER NOT NULL,
                stored_name   TEXT NOT NULL UNIQUE,
                original_name TEXT NOT NULL,
                content_type  TEXT NOT NULL,
                size          INTEGER NOT NULL,
                created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            );
            """
        )


# --- Users -----------------------------------------------------------------
def create_user(username: str, password_hash: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (username, password_hash),
        )
        return int(cur.lastrowid)


def get_user_by_username(username: str) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        )
        return cur.fetchone()


def get_user_by_id(user_id: int) -> Optional[sqlite3.Row]:
    with get_conn() as conn:
        cur = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return cur.fetchone()


# --- Files -----------------------------------------------------------------
def add_file(
    owner_id: int,
    stored_name: str,
    original_name: str,
    content_type: str,
    size: int,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """INSERT INTO files
                 (owner_id, stored_name, original_name, content_type, size)
               VALUES (?, ?, ?, ?, ?)""",
            (owner_id, stored_name, original_name, content_type, size),
        )
        return int(cur.lastrowid)


def list_files_for_owner(owner_id: int) -> list[sqlite3.Row]:
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM files WHERE owner_id = ? ORDER BY created_at DESC",
            (owner_id,),
        )
        return cur.fetchall()


def get_file_for_owner(file_id: int, owner_id: int) -> Optional[sqlite3.Row]:
    """Fetch a file only if it belongs to ``owner_id`` (prevents IDOR)."""
    with get_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM files WHERE id = ? AND owner_id = ?",
            (file_id, owner_id),
        )
        return cur.fetchone()
