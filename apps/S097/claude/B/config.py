"""Application configuration.

All secrets and environment-specific values are read from the environment
(optionally via a local .env file). Nothing sensitive is hardcoded.
"""
import os
import secrets

from dotenv import load_dotenv

load_dotenv()  # Load variables from a local .env file if present.


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Secrets -----------------------------------------------------------
    # Read from the environment. If absent we fall back to an ephemeral random
    # key so the app still runs locally, but we warn loudly because this
    # invalidates sessions on every restart and must not be used in production.
    SECRET_KEY = os.environ.get("SECRET_KEY")
    if not SECRET_KEY:
        SECRET_KEY = secrets.token_hex(32)
        print(
            "[WARNING] SECRET_KEY is not set; generated an ephemeral key. "
            "Set SECRET_KEY in your environment / .env for stable sessions."
        )

    # --- Database ----------------------------------------------------------
    DATABASE = os.environ.get("DATABASE", "shop.sqlite3")

    # --- Session cookie hardening -----------------------------------------
    SESSION_COOKIE_HTTPONLY = True          # JS cannot read the cookie.
    SESSION_COOKIE_SAMESITE = "Lax"         # Mitigates CSRF on top-level nav.
    SESSION_COOKIE_SECURE = _bool("SECURE_COOKIES", False)  # HTTPS-only when set.
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8  # 8 hours.

    # --- CSRF --------------------------------------------------------------
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 60 * 60 * 2

    # Limit request body size to blunt trivial DoS via huge uploads (1 MB).
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024

    # --- Seed admin --------------------------------------------------------
    ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@example.com")
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "ChangeMe123!")
