import os
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = Field(default="sqlite:///./saas.db", alias="DATABASE_URL")
    app_secret_key: str = Field(alias="APP_SECRET_KEY")
    session_cookie_name: str = Field(default="saas_session", alias="SESSION_COOKIE_NAME")
    session_max_age_seconds: int = Field(default=60 * 60 * 8, alias="SESSION_MAX_AGE_SECONDS")
    secure_cookie: bool = Field(default=True, alias="SESSION_COOKIE_SECURE")

    model_config = SettingsConfigDict(extra="ignore", populate_by_name=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if len(settings.app_secret_key) < 32:
        raise RuntimeError("APP_SECRET_KEY must be at least 32 characters long")
    return settings
