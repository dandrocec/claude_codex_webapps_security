"""Application configuration.

All sensitive / environment-specific values are read from environment
variables. Nothing secret is hard-coded. See README.md for the list of
supported variables.
"""
import os
import secrets


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


class Config:
    # --- Secrets -----------------------------------------------------------
    # SECRET_KEY MUST be provided in production. For local convenience we
    # generate a random ephemeral key if one is not supplied (sessions will
    # not survive a restart in that case, which is intentional and safe).
    SECRET_KEY = os.environ.get("SECRET_KEY") or secrets.token_hex(32)

    # --- Database ----------------------------------------------------------
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "recruiting.sqlite3"),
    )

    # --- File uploads ------------------------------------------------------
    UPLOAD_DIR = os.environ.get(
        "UPLOAD_DIR",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads"),
    )
    # Hard limit on the whole request body (resume + form fields). 5 MiB.
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_BYTES", 5 * 1024 * 1024))

    # --- Session / cookie hardening ---------------------------------------
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    # Secure cookies require HTTPS. Default OFF so the app runs over plain
    # HTTP on localhost. Set SESSION_COOKIE_SECURE=true behind TLS in prod.
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", False)
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SAMESITE = "Lax"
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE

    # Flask-WTF CSRF token lifetime (seconds). None => tied to session.
    WTF_CSRF_TIME_LIMIT = None

    # Never run with debug on in this app; errors are handled explicitly so
    # stack traces are never leaked to clients.
    DEBUG = False
    TESTING = False
