"""Application configuration.

All sensitive / environment-specific values are read from the environment.
Nothing secret is hardcoded here.
"""
import os
from datetime import timedelta


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


class Config:
    # SECRET_KEY must come from the environment. We refuse to start without it
    # (see create_app) rather than fall back to a predictable default.
    SECRET_KEY = os.environ.get("SECRET_KEY")

    # Database location (file path for SQLite).
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "timetracker.db"),
    )

    # --- Session / cookie hardening ---
    SESSION_COOKIE_HTTPONLY = True          # JS cannot read the cookie
    SESSION_COOKIE_SAMESITE = "Lax"         # CSRF defence-in-depth
    # Secure defaults to True. For local plain-HTTP testing on port 5054 set
    # SESSION_COOKIE_SECURE=false in the environment, otherwise the browser
    # will refuse to send the cookie over http://localhost.
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", True)
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    # CSRF tokens follow the same Secure policy as the session cookie.
    WTF_CSRF_TIME_LIMIT = None  # token valid for the life of the session
