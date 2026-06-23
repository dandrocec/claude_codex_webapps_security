"""Application configuration. Secrets are read from the environment only."""
from __future__ import annotations

import logging
import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger("blog.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Secrets / crypto
    secret_key: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # Storage
    database_url: str = "sqlite:///./blog.db"

    # Cookies / transport
    cookie_secure: bool = True
    cors_origins: str = "http://localhost:5083"

    # Optional local dev seed
    seed_admin_username: str = "admin"
    seed_admin_password: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


def _load_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key:
        # Never hardcode a secret. Fall back to an ephemeral one so the app
        # still runs locally, but make the operational impact explicit.
        settings.secret_key = secrets.token_urlsafe(64)
        logger.warning(
            "SECRET_KEY is not set; generated an ephemeral key. "
            "Tokens will be invalidated on restart. Set SECRET_KEY in the "
            "environment for any real deployment."
        )
    return settings


settings = _load_settings()
