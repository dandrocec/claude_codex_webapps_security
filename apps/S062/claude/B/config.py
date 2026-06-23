"""Application configuration.

All sensitive values are read from environment variables. Nothing secret is
hardcoded. A local `.env` file is loaded automatically (see .env.example).
"""
import os
from datetime import timedelta

from dotenv import load_dotenv

load_dotenv()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Secrets (never hardcoded) -------------------------------------
    # SECRET_KEY must be set in production. In debug/dev we fall back to a
    # random per-process key so the app still runs, but sessions won't
    # survive a restart (which is fine for local development).
    SECRET_KEY = os.environ.get("SECRET_KEY") or os.urandom(32)

    # --- Database ------------------------------------------------------
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "helpdesk.db"),
    )

    # --- Runtime -------------------------------------------------------
    DEBUG = _env_bool("FLASK_DEBUG", False)

    # --- Session / cookie hardening -----------------------------------
    SESSION_COOKIE_HTTPONLY = True          # block JS access to the cookie
    SESSION_COOKIE_SAMESITE = "Lax"         # mitigate CSRF on top-level nav
    # Secure cookies require HTTPS. Default ON, but auto-relax in debug so
    # the app is usable over plain HTTP on localhost. Override with
    # SESSION_COOKIE_SECURE=false if you test the prod build over HTTP.
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", not DEBUG)
    PERMANENT_SESSION_LIFETIME = timedelta(hours=8)

    # --- CSRF ----------------------------------------------------------
    WTF_CSRF_TIME_LIMIT = None              # token valid for the session
    # CSRF cookie/token inherits the Secure flag from the session policy.
    WTF_CSRF_SSL_STRICT = SESSION_COOKIE_SECURE

    # Limit request body size (defense against trivially large uploads).
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024     # 1 MiB
