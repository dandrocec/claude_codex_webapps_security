"""Application configuration.

Secrets and environment-specific values are read from the environment
(loaded from a local .env file in development). Nothing sensitive is
hard-coded here.
"""
import os
import secrets


def _env_bool(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    ENV = os.environ.get("FLASK_ENV", "production")
    IS_PRODUCTION = ENV == "production"

    # --- Secret key -------------------------------------------------------
    # Required in production. In development we fall back to an ephemeral
    # random key (sessions won't survive a restart, which is fine locally).
    SECRET_KEY = os.environ.get("SECRET_KEY")
    if not SECRET_KEY:
        if ENV == "production":
            raise RuntimeError(
                "SECRET_KEY environment variable is required in production."
            )
        SECRET_KEY = secrets.token_hex(32)

    # --- Database ---------------------------------------------------------
    SQLALCHEMY_DATABASE_URI = os.environ.get("DATABASE_URL", "sqlite:///qrapp.db")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # --- Session / cookie hardening --------------------------------------
    SESSION_COOKIE_HTTPONLY = True          # JS cannot read the cookie -> mitigates XSS theft
    SESSION_COOKIE_SAMESITE = "Lax"         # CSRF defence-in-depth
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", IS_PRODUCTION)
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE
    REMEMBER_COOKIE_SAMESITE = "Lax"

    # --- CSRF -------------------------------------------------------------
    WTF_CSRF_ENABLED = True
    WTF_CSRF_TIME_LIMIT = 3600

    # --- App limits -------------------------------------------------------
    MAX_CONTENT_LENGTH = 64 * 1024          # cap request body size
    QR_MAX_INPUT_LENGTH = 1800              # max characters encoded in a QR
