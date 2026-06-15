"""Database models.

All persistence goes through SQLAlchemy's ORM, which uses bound/
parameterised queries under the hood — user input is never concatenated
into SQL strings, so SQL injection is structurally prevented.

Passwords are hashed with Argon2id (a strong, salted, memory-hard
algorithm). Plaintext passwords are never stored.
"""
import uuid
from datetime import datetime, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from flask_login import UserMixin
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()

# Argon2id with sensible defaults; salting is automatic and per-hash.
_password_hasher = PasswordHasher()


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(UserMixin, db.Model):
    __tablename__ = "users"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_now, nullable=False)

    qrcodes = db.relationship(
        "QRCode", backref="owner", lazy=True, cascade="all, delete-orphan"
    )

    def set_password(self, password: str) -> None:
        self.password_hash = _password_hasher.hash(password)

    def check_password(self, password: str) -> bool:
        try:
            _password_hasher.verify(self.password_hash, password)
        except (VerifyMismatchError, InvalidHashError):
            return False
        # Transparently upgrade the hash if Argon2 parameters have changed.
        if _password_hasher.check_needs_rehash(self.password_hash):
            self.password_hash = _password_hasher.hash(password)
            db.session.commit()
        return True


class QRCode(db.Model):
    __tablename__ = "qrcodes"

    id = db.Column(db.String(32), primary_key=True, default=_uuid)
    user_id = db.Column(
        db.String(32), db.ForeignKey("users.id"), nullable=False, index=True
    )
    content = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=_now, nullable=False)
