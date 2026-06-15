"""Application configuration.

Secrets and environment-specific settings are read from environment
variables. Nothing sensitive is hardcoded.
"""
import os
import secrets


def _get_secret_key() -> str:
    """Return the Flask secret key.

    In production the SECRET_KEY environment variable MUST be set. For local
    development we fall back to a freshly generated random key so the app is
    runnable out of the box. A generated key invalidates sessions on restart,
    which is acceptable for development but not for production.
    """
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    if os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError(
            "SECRET_KEY environment variable must be set in production."
        )
    return secrets.token_hex(32)


class Config:
    SECRET_KEY = _get_secret_key()

    # SQLite database location (override with DATABASE_PATH if desired).
    DATABASE_PATH = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "wiki.db"),
    )

    # Session cookie hardening.
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Secure cookies require HTTPS. Enabled by default; set
    # SESSION_COOKIE_SECURE=0 for plain-HTTP local testing.
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "1") != "0"

    # CSRF tokens and "remember me" cookies inherit the same protections.
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SAMESITE = "Lax"
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE

    WTF_CSRF_TIME_LIMIT = None  # token valid for the session lifetime

    # Reject excessively large request bodies (1 MB).
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024
