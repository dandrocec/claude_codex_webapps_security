"""Application configuration.

All secrets and environment-specific switches are read from environment
variables. Nothing sensitive is hardcoded (OWASP A05: Security Misconfiguration,
A07: Identification & Authentication Failures).
"""
import os
import secrets


def _env_bool(name: str, default: bool) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Secrets -----------------------------------------------------------
    # Never hardcode the secret key. If it is missing we generate a random
    # ephemeral one so the app still runs locally, but sessions will not
    # survive a restart. In production FLASK_SECRET_KEY MUST be set.
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY") or secrets.token_hex(32)
    SECRET_KEY_IS_EPHEMERAL = "FLASK_SECRET_KEY" not in os.environ

    # --- Database ----------------------------------------------------------
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "membership.db"),
    )

    # --- Session / cookie security ----------------------------------------
    # HttpOnly: JavaScript cannot read the cookie (mitigates XSS session theft).
    SESSION_COOKIE_HTTPONLY = True
    # SameSite=Lax: cookie not sent on cross-site POSTs (defense in depth vs CSRF).
    SESSION_COOKIE_SAMESITE = "Lax"
    # Secure: cookie only sent over HTTPS. Defaults to False so the app is
    # runnable over plain HTTP on localhost; set SESSION_COOKIE_SECURE=true in
    # production (where you terminate TLS).
    SESSION_COOKIE_SECURE = _env_bool("SESSION_COOKIE_SECURE", False)

    # CSRF tokens travel in the session; align WTF cookie settings.
    WTF_CSRF_TIME_LIMIT = None  # token valid for the life of the session

    # Idle/absolute session lifetime.
    PERMANENT_SESSION_LIFETIME = 60 * 60 * 8  # 8 hours

    # --- First-run admin bootstrap ----------------------------------------
    # Optional: create an initial admin account on first launch.
    BOOTSTRAP_ADMIN_EMAIL = os.environ.get("BOOTSTRAP_ADMIN_EMAIL")
    BOOTSTRAP_ADMIN_PASSWORD = os.environ.get("BOOTSTRAP_ADMIN_PASSWORD")
