"""Application configuration.

All secrets are read from the environment. Nothing sensitive is hardcoded.
For local development, missing secrets fall back to an ephemeral random value
(regenerated each start) with a warning, so the app stays runnable while never
shipping a baked-in credential.
"""
import os
import secrets
import logging

log = logging.getLogger(__name__)


def _required_secret(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        value = secrets.token_hex(32)
        log.warning(
            "%s not set in environment; generated an ephemeral value. "
            "Sessions/webhooks will reset on restart. Set %s in your .env "
            "for stable behaviour.",
            name, name,
        )
    return value


class Config:
    # Core secrets (env-driven; ephemeral fallback for dev only).
    SECRET_KEY = _required_secret("SECRET_KEY")
    WEBHOOK_SECRET = _required_secret("WEBHOOK_SECRET")

    # Database
    BASE_DIR = os.path.abspath(os.path.dirname(__file__))
    DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "shop.db"))

    # Secure session cookies
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "0") == "1"
    REMEMBER_COOKIE_HTTPONLY = True
    REMEMBER_COOKIE_SAMESITE = "Lax"
    REMEMBER_COOKIE_SECURE = SESSION_COOKIE_SECURE

    # CSRF
    WTF_CSRF_ENABLED = True

    # Limit request body size (defence against oversized payloads).
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024  # 1 MB

    # Payment provider configuration
    PAYMENT_PROVIDER = os.environ.get("PAYMENT_PROVIDER", "sandbox").lower()
    BASE_URL = os.environ.get("BASE_URL", "http://localhost:5089").rstrip("/")
    CURRENCY = "usd"

    # Stripe (optional)
    STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
    STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

    DEBUG = os.environ.get("FLASK_DEBUG", "0") == "1"
