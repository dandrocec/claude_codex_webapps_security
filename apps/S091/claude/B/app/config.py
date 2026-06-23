"""Application configuration.

All secrets and tunables are read from environment variables (12-factor style).
Nothing sensitive is hardcoded.
"""
import os
import secrets
import logging

logger = logging.getLogger("microblog.config")


def _as_bool(value: str, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    def __init__(self) -> None:
        secret = os.environ.get("SECRET_KEY")
        if not secret:
            # Generate an ephemeral secret so the app still runs out of the box.
            # This is fine for local development but means sessions are cleared on
            # restart. Production MUST set SECRET_KEY explicitly.
            secret = secrets.token_urlsafe(48)
            logger.warning(
                "SECRET_KEY not set; generated an ephemeral one. "
                "Set SECRET_KEY in the environment for production."
            )
        self.SECRET_KEY: str = secret

        self.DATABASE_URL: str = os.environ.get("DATABASE_URL", "sqlite:///./microblog.db")
        self.HOST: str = os.environ.get("HOST", "127.0.0.1")
        self.PORT: int = int(os.environ.get("PORT", "5091"))

        self.COOKIE_NAME: str = "mb_session"
        self.COOKIE_SECURE: bool = _as_bool(os.environ.get("COOKIE_SECURE"), False)
        self.COOKIE_SAMESITE: str = os.environ.get("COOKIE_SAMESITE", "lax").lower()
        self.SESSION_TTL_HOURS: int = int(os.environ.get("SESSION_TTL_HOURS", "24"))

        self.WORKER_ENABLED: bool = _as_bool(os.environ.get("WORKER_ENABLED"), True)
        self.WORKER_POLL_SECONDS: float = float(os.environ.get("WORKER_POLL_SECONDS", "1.0"))

        self.LINK_PREVIEW_TIMEOUT: float = float(os.environ.get("LINK_PREVIEW_TIMEOUT", "5"))
        self.LINK_PREVIEW_MAX_BYTES: int = int(os.environ.get("LINK_PREVIEW_MAX_BYTES", str(512 * 1024)))
        self.LINK_PREVIEW_MAX_REDIRECTS: int = int(os.environ.get("LINK_PREVIEW_MAX_REDIRECTS", "3"))
        self.LINK_PREVIEW_MAX_PER_POST: int = int(os.environ.get("LINK_PREVIEW_MAX_PER_POST", "3"))

        self.DEBUG: bool = _as_bool(os.environ.get("DEBUG"), False)

        # Content limits (input validation).
        self.MAX_POST_LENGTH: int = 280
        self.MIN_PASSWORD_LENGTH: int = 8
        self.MAX_PASSWORD_BYTES: int = 72  # bcrypt hard limit.


settings = Settings()
