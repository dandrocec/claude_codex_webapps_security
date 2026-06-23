"""Application configuration.

All secrets and tunables are read from environment variables. Nothing
sensitive is hardcoded. A `.env` file is loaded automatically if present
(see `.env.example`).
"""
from __future__ import annotations

import os
import secrets
import sys

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - dotenv is optional at runtime
    pass


def _get_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


class Settings:
    """Runtime settings sourced exclusively from the environment."""

    def __init__(self) -> None:
        # Secret used to sign/derive session-related values. Read from the
        # environment; never hardcoded. If missing we generate an ephemeral
        # key so the app is runnable for local development, but we warn loudly
        # because sessions will not survive a restart and this is unsafe for
        # production.
        secret = os.environ.get("SECRET_KEY")
        if not secret:
            secret = secrets.token_urlsafe(48)
            print(
                "[WARNING] SECRET_KEY is not set. Generated an ephemeral key for "
                "this process only. Set SECRET_KEY in the environment for "
                "production use.",
                file=sys.stderr,
            )
        self.SECRET_KEY: str = secret

        self.DATABASE_URL: str = os.environ.get(
            "DATABASE_URL", "sqlite:///./jobrunner.db"
        )

        # Cookies are marked Secure by default. For local plain-HTTP testing on
        # http://127.0.0.1 set COOKIE_SECURE=false, otherwise the browser will
        # never send the cookie back.
        self.COOKIE_SECURE: bool = _get_bool("COOKIE_SECURE", True)
        self.COOKIE_NAME: str = os.environ.get("SESSION_COOKIE_NAME", "jobrunner_session")

        # Session lifetime in seconds (default 12 hours).
        self.SESSION_TTL_SECONDS: int = int(
            os.environ.get("SESSION_TTL_SECONDS", str(12 * 60 * 60))
        )

        # Per-job wall-clock timeout in seconds.
        self.JOB_TIMEOUT_SECONDS: int = int(
            os.environ.get("JOB_TIMEOUT_SECONDS", "300")
        )

        # Maximum size of captured output stored per job (bytes).
        self.MAX_OUTPUT_BYTES: int = int(
            os.environ.get("MAX_OUTPUT_BYTES", str(256 * 1024))
        )

        self.HOST: str = os.environ.get("HOST", "127.0.0.1")
        self.PORT: int = int(os.environ.get("PORT", "5095"))


settings = Settings()
