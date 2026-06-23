"""Application configuration.

All sensitive / environment-specific values are read from environment
variables. Nothing secret is hardcoded. A local `.env` file is loaded
automatically (see `.env.example`) for convenience during development.
"""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _bool_env(name: str, default: bool) -> bool:
    """Parse a boolean environment variable."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Secrets -----------------------------------------------------------
    # SECRET_KEY is mandatory in production. We fall back to a random value
    # only so the app can still boot in a throwaway dev session; that means
    # sessions reset on restart, which is the safe default.
    SECRET_KEY = os.environ.get("SECRET_KEY") or os.urandom(32).hex()

    # --- Database ----------------------------------------------------------
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "blog.db"),
    )

    # --- Session / cookie hardening ---------------------------------------
    # Secure=True means cookies are only sent over HTTPS. For plain-HTTP
    # local testing set SESSION_COOKIE_SECURE=False in your environment.
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SECURE = _bool_env("SESSION_COOKIE_SECURE", True)
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    # Remember-cookie (Flask-Login) gets the same protections.
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SECURE = _bool_env("SESSION_COOKIE_SECURE", True)
    REMEMBER_COOKIE_SAMESITE = "Lax"

    # --- CSRF --------------------------------------------------------------
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 3600

    # --- Misc --------------------------------------------------------------
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024  # 1 MB request cap
