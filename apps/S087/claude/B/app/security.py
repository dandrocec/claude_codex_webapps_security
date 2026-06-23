"""Security primitives: password hashing, CSRF tokens, and input validation."""
import re
import secrets

import bcrypt
from email_validator import EmailNotValidError, validate_email

# --- Password hashing (bcrypt: strong, salted, adaptive) --------------------

# bcrypt operates on at most 72 bytes; we cap password length in validation so
# truncation can never silently happen.
MAX_PASSWORD_LENGTH = 64
MIN_PASSWORD_LENGTH = 10


def hash_password(plain: str) -> str:
    """Return a salted bcrypt hash. A fresh random salt is generated per call."""
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Constant-time password verification."""
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# --- CSRF (synchronizer token pattern) --------------------------------------


def get_or_create_csrf_token(session: dict) -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf_token(session: dict, submitted: str | None) -> bool:
    expected = session.get("csrf_token")
    if not expected or not submitted:
        return False
    # Constant-time comparison to avoid timing leaks.
    return secrets.compare_digest(expected, submitted)


# --- Input validation -------------------------------------------------------

_SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,78}[a-z0-9])?$")


class ValidationError(ValueError):
    """Raised when user-supplied input fails validation."""


def clean_str(value: str | None, *, field: str, min_len: int, max_len: int) -> str:
    value = (value or "").strip()
    if len(value) < min_len:
        raise ValidationError(f"{field} must be at least {min_len} character(s).")
    if len(value) > max_len:
        raise ValidationError(f"{field} must be at most {max_len} characters.")
    return value


def clean_email(value: str | None) -> str:
    value = (value or "").strip()
    try:
        # Normalises and validates; deliverability check disabled for offline use.
        result = validate_email(value, check_deliverability=False)
    except EmailNotValidError as exc:
        raise ValidationError(f"Invalid email address: {exc}") from exc
    return result.normalized.lower()


def clean_password(value: str | None) -> str:
    value = value or ""
    if len(value) < MIN_PASSWORD_LENGTH:
        raise ValidationError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(value) > MAX_PASSWORD_LENGTH:
        raise ValidationError(
            f"Password must be at most {MAX_PASSWORD_LENGTH} characters."
        )
    return value


def slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return slug[:80]


def clean_slug(value: str | None) -> str:
    value = (value or "").strip().lower()
    if not _SLUG_RE.match(value):
        raise ValidationError(
            "Organisation slug must be 2-80 chars, lowercase letters, digits "
            "and hyphens only."
        )
    return value


def clean_role(value: str | None) -> str:
    from .models import VALID_ROLES

    value = (value or "").strip().lower()
    if value not in VALID_ROLES:
        raise ValidationError("Invalid role.")
    return value
