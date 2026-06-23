"""Lightweight data-access layer. Every query is parameterised."""

from __future__ import annotations

import sqlite3
from dataclasses import dataclass

from flask_login import UserMixin

from .db import get_db


@dataclass
class User(UserMixin):
    id: int
    email: str
    role: str

    @property
    def is_candidate(self) -> bool:
        return self.role == "candidate"

    @property
    def is_recruiter(self) -> bool:
        return self.role == "recruiter"


def _row_to_user(row: sqlite3.Row | None) -> User | None:
    if row is None:
        return None
    return User(id=row["id"], email=row["email"], role=row["role"])


def get_user_by_id(user_id: int) -> User | None:
    row = get_db().execute(
        "SELECT id, email, role FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return _row_to_user(row)


def get_user_record_by_email(email: str) -> sqlite3.Row | None:
    """Returns the full row (including password_hash) for authentication."""
    return get_db().execute(
        "SELECT id, email, role, password_hash FROM users WHERE email = ?",
        (email,),
    ).fetchone()


def create_user(email: str, password_hash: str, role: str, full_name: str) -> int:
    db = get_db()
    cur = db.execute(
        "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
        (email, password_hash, role),
    )
    user_id = cur.lastrowid
    if role == "candidate":
        db.execute(
            "INSERT INTO profiles (user_id, full_name) VALUES (?, ?)",
            (user_id, full_name),
        )
    db.commit()
    return user_id


def update_password_hash(user_id: int, password_hash: str) -> None:
    db = get_db()
    db.execute(
        "UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id)
    )
    db.commit()


def get_profile_by_user(user_id: int) -> sqlite3.Row | None:
    return get_db().execute(
        "SELECT * FROM profiles WHERE user_id = ?", (user_id,)
    ).fetchone()


def get_profile_by_id(profile_id: int) -> sqlite3.Row | None:
    return get_db().execute(
        "SELECT p.*, u.email AS email FROM profiles p "
        "JOIN users u ON u.id = p.user_id WHERE p.id = ?",
        (profile_id,),
    ).fetchone()


def update_profile(
    user_id: int,
    full_name: str,
    headline: str,
    location: str,
    bio: str,
    skills: str,
) -> None:
    db = get_db()
    db.execute(
        "UPDATE profiles SET full_name = ?, headline = ?, location = ?, "
        "bio = ?, skills = ?, updated_at = datetime('now') WHERE user_id = ?",
        (full_name, headline, location, bio, skills, user_id),
    )
    db.commit()


def set_resume(user_id: int, stored_name: str, original_name: str) -> None:
    db = get_db()
    db.execute(
        "UPDATE profiles SET resume_filename = ?, resume_original = ?, "
        "updated_at = datetime('now') WHERE user_id = ?",
        (stored_name, original_name, user_id),
    )
    db.commit()


def search_candidates_by_skill(skill: str) -> list[sqlite3.Row]:
    """Search profiles whose normalised skill list contains ``skill``.

    The term is bound as a parameter; the surrounding ``%`` wildcards and the
    ``\\`` escape are applied to the value, not the SQL text.
    """
    term = skill.strip().lower()
    like = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    return get_db().execute(
        "SELECT id, full_name, headline, location, skills "
        "FROM profiles WHERE skills LIKE ? ESCAPE '\\' "
        "ORDER BY full_name LIMIT 100",
        (like,),
    ).fetchall()


def list_recent_candidates(limit: int = 50) -> list[sqlite3.Row]:
    return get_db().execute(
        "SELECT id, full_name, headline, location, skills "
        "FROM profiles ORDER BY updated_at DESC LIMIT ?",
        (limit,),
    ).fetchall()
