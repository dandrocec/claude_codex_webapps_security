"""Security primitives: password hashing, sessions, CSRF and headers."""
from __future__ import annotations

import datetime as dt
import hmac
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from sqlalchemy.orm import Session as DbSession

from .config import settings
from .models import Session as SessionModel, User, utcnow

# Argon2id is a strong, salted, memory-hard password hashing algorithm. The
# PasswordHasher generates a random salt per password and embeds the salt and
# all parameters in the encoded hash string.
_password_hasher = PasswordHasher()


def hash_password(plaintext: str) -> str:
    return _password_hasher.hash(plaintext)


def verify_password(stored_hash: str, plaintext: str) -> bool:
    try:
        _password_hasher.verify(stored_hash, plaintext)
        return True
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def needs_rehash(stored_hash: str) -> bool:
    try:
        return _password_hasher.check_needs_rehash(stored_hash)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------
def create_session(db: DbSession, user: User) -> SessionModel:
    token = secrets.token_urlsafe(32)
    csrf = secrets.token_urlsafe(32)
    expires = utcnow() + dt.timedelta(seconds=settings.SESSION_TTL_SECONDS)
    session = SessionModel(
        id=token,
        user_id=user.id,
        csrf_token=csrf,
        expires_at=expires,
    )
    db.add(session)
    db.commit()
    return session


def get_session(db: DbSession, token: str | None) -> SessionModel | None:
    if not token:
        return None
    session = db.get(SessionModel, token)
    if session is None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=dt.timezone.utc)
    if expires_at < utcnow():
        db.delete(session)
        db.commit()
        return None
    return session


def destroy_session(db: DbSession, token: str | None) -> None:
    if not token:
        return
    session = db.get(SessionModel, token)
    if session is not None:
        db.delete(session)
        db.commit()


def csrf_valid(session: SessionModel, submitted: str | None) -> bool:
    if not submitted or not session:
        return False
    # Constant-time comparison to avoid timing side-channels.
    return hmac.compare_digest(session.csrf_token, submitted)


def set_session_cookie(response, token: str) -> None:
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_TTL_SECONDS,
        httponly=True,            # not readable by JavaScript -> mitigates XSS theft
        secure=settings.COOKIE_SECURE,  # only sent over HTTPS
        samesite="lax",          # mitigates CSRF on top of the token check
        path="/",
    )


def clear_session_cookie(response) -> None:
    response.delete_cookie(key=settings.COOKIE_NAME, path="/")


# ---------------------------------------------------------------------------
# Security headers
# ---------------------------------------------------------------------------
SECURITY_HEADERS = {
    # Restrictive CSP. The UI uses a single external stylesheet served from the
    # same origin and no inline scripts, so default-src 'self' is sufficient.
    "Content-Security-Policy": (
        "default-src 'self'; "
        "style-src 'self'; "
        "script-src 'self'; "
        "img-src 'self' data:; "
        "object-src 'none'; "
        "base-uri 'none'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=()",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
}


def apply_security_headers(response, *, https: bool) -> None:
    for key, value in SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    if https:
        response.headers.setdefault(
            "Strict-Transport-Security",
            "max-age=63072000; includeSubDomains",
        )
