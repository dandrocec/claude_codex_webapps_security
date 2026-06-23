"""Application configuration, read entirely from the environment.

No secrets are hardcoded. Missing critical secrets cause a hard failure at
startup rather than silently falling back to an insecure default.
"""
import os


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Config:
    # --- Secrets (must come from the environment) ---------------------------
    SECRET_KEY = os.environ.get("SECRET_KEY")

    # --- Database ----------------------------------------------------------
    DATABASE = os.environ.get(
        "DATABASE_PATH",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.db"),
    )

    # --- Session / cookie hardening ----------------------------------------
    # Secure-by-default. For plain-HTTP local testing set
    # SESSION_COOKIE_SECURE=false in your .env (the cookie would otherwise
    # never be sent over http and login would appear to "not work").
    SESSION_COOKIE_SECURE = _bool("SESSION_COOKIE_SECURE", True)
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = 60 * 30  # 30 minutes

    # CSRF tokens should also only travel over TLS when Secure is enabled.
    WTF_CSRF_TIME_LIMIT = 60 * 60

    # --- Misc --------------------------------------------------------------
    MAX_CONTENT_LENGTH = 1 * 1024 * 1024  # 1 MB request cap

    @staticmethod
    def validate() -> None:
        if not Config.SECRET_KEY:
            raise RuntimeError(
                "SECRET_KEY environment variable is required. "
                "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
            )
