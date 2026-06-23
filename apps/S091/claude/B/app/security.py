"""Password hashing, token generation and CSRF comparison helpers."""
import re
import secrets

import bcrypt

from .config import settings

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,30}$")
# Extract http/https URLs from post bodies for link previews.
_URL_RE = re.compile(r"https?://[^\s<>\"')]+", re.IGNORECASE)


def hash_password(password: str) -> str:
    pw = password.encode("utf-8")
    if len(pw) > settings.MAX_PASSWORD_BYTES:
        raise ValueError("password too long")
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(
            password.encode("utf-8")[: settings.MAX_PASSWORD_BYTES],
            password_hash.encode("utf-8"),
        )
    except (ValueError, TypeError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def constant_time_equals(a: str | None, b: str | None) -> bool:
    if not a or not b:
        return False
    return secrets.compare_digest(a, b)


def valid_username(username: str) -> bool:
    return bool(_USERNAME_RE.match(username or ""))


def extract_urls(text: str, limit: int) -> list[str]:
    seen: list[str] = []
    for match in _URL_RE.findall(text or ""):
        url = match.rstrip(".,)")
        if url not in seen:
            seen.append(url)
        if len(seen) >= limit:
            break
    return seen
