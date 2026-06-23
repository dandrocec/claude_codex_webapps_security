"""Application configuration.

Secrets and environment-specific switches are read from environment
variables. Nothing sensitive is hardcoded.
"""
import os


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # SECRET_KEY MUST be set in production. A random throwaway key is used as a
    # last resort so the app still boots in dev, but sessions then reset on
    # every restart.
    SECRET_KEY = os.environ.get("SECRET_KEY") or os.urandom(32).hex()

    # Database. Defaults to a local SQLite file next to the project.
    basedir = os.path.abspath(os.path.dirname(__file__))
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "sqlite:///" + os.path.join(basedir, "instance", "app.db")
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- Session / cookie hardening ---------------------------------------
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Secure cookies require HTTPS. Default False so the app works over plain
    # http://localhost during development; set SESSION_COOKIE_SECURE=true (and
    # serve over HTTPS) in production.
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", False)
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE
    REMEMBER_COOKIE_SAMESITE = "Lax"

    # WTForms / Flask-WTF CSRF protection is enabled globally.
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = None  # token valid for the session lifetime

    # Limit request body size to mitigate trivial DoS via huge payloads (1 MB).
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024
