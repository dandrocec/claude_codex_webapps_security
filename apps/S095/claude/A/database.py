"""SQLite persistence layer (stdlib only, no ORM dependency)."""

import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

DB_PATH = Path(__file__).parent / "jobrunner.db"

# A single module-level lock keeps writes from interleaving. SQLite handles
# concurrent readers fine, but worker threads update rows while requests read
# them, so we serialize access through one connection guarded by a lock.
_lock = threading.Lock()
_conn: sqlite3.Connection | None = None


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_connection() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
    return _conn


@contextmanager
def transaction():
    conn = get_connection()
    with _lock:
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise


def init_db() -> None:
    with transaction() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                username    TEXT NOT NULL,
                command     TEXT NOT NULL,
                status      TEXT NOT NULL DEFAULT 'pending',
                exit_code   INTEGER,
                output      TEXT NOT NULL DEFAULT '',
                created_at  TEXT NOT NULL,
                started_at  TEXT,
                finished_at TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id)
            );
            """
        )


# --- users -----------------------------------------------------------------

def create_user(username: str, password_hash: str) -> int:
    with transaction() as conn:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, password_hash, _utcnow()),
        )
        return cur.lastrowid


def get_user_by_username(username: str) -> sqlite3.Row | None:
    cur = get_connection().execute(
        "SELECT * FROM users WHERE username = ?", (username,)
    )
    return cur.fetchone()


def count_users() -> int:
    cur = get_connection().execute("SELECT COUNT(*) AS n FROM users")
    return cur.fetchone()["n"]


# --- jobs ------------------------------------------------------------------

def create_job(user_id: int, username: str, command: str) -> int:
    with transaction() as conn:
        cur = conn.execute(
            "INSERT INTO jobs (user_id, username, command, status, created_at) "
            "VALUES (?, ?, ?, 'pending', ?)",
            (user_id, username, command, _utcnow()),
        )
        return cur.lastrowid


def mark_running(job_id: int) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE jobs SET status='running', started_at=? WHERE id=?",
            (_utcnow(), job_id),
        )


def append_output(job_id: int, chunk: str) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE jobs SET output = output || ? WHERE id=?", (chunk, job_id)
        )


def finish_job(job_id: int, status: str, exit_code: int | None) -> None:
    with transaction() as conn:
        conn.execute(
            "UPDATE jobs SET status=?, exit_code=?, finished_at=? WHERE id=?",
            (status, exit_code, _utcnow(), job_id),
        )


def list_jobs(limit: int = 100) -> list[sqlite3.Row]:
    cur = get_connection().execute(
        "SELECT * FROM jobs ORDER BY id DESC LIMIT ?", (limit,)
    )
    return cur.fetchall()


def get_job(job_id: int) -> sqlite3.Row | None:
    cur = get_connection().execute("SELECT * FROM jobs WHERE id=?", (job_id,))
    return cur.fetchone()
