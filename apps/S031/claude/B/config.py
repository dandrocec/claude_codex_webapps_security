"""Application configuration.

All secrets and environment-specific settings are read from environment
variables (never hardcoded). See .env.example for the full list.
"""
import os
from datetime import timedelta


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # ------------------------------------------------------------------ #
    # Secrets — must come from the environment. We refuse to start with a
    # weak/guessable default in production (see app.create_app()).
    # ------------------------------------------------------------------ #
    SECRET_KEY = os.environ.get("SECRET_KEY")

    # ------------------------------------------------------------------ #
    # Database
    # ------------------------------------------------------------------ #
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(__file__), "instance", "recipes.db"),
    )

    # ------------------------------------------------------------------ #
    # Uploads
    # ------------------------------------------------------------------ #
    UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "static", "uploads")
    MAX_CONTENT_LENGTH = 4 * 1024 * 1024  # 4 MB cap on request body
    ALLOWED_IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}

    # ------------------------------------------------------------------ #
    # Session / cookie hardening
    #   SESSION_COOKIE_SECURE defaults to True. Set to False (e.g. in
    #   .env) only for plain-HTTP local development.
    # ------------------------------------------------------------------ #
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", True)
    PERMANENT_SESSION_LIFETIME = timedelta(days=7)

    # CSRF tokens inherit the same secure-cookie posture.
    WTF_CSRF_TIME_LIMIT = None  # token valid for the session lifetime

    # Jinja autoescaping is on by default for .html templates; make it
    # explicit so it is never accidentally disabled.
    TEMPLATES_AUTO_RELOAD = False
