from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    secret_key: str = Field(min_length=32)
    database_url: str = "sqlite:///./microblog.db"
    redis_url: str = "redis://localhost:6379/0"
    session_cookie_secure: bool = True
    session_cookie_name: str = "microblog_session"
    csrf_cookie_name: str = "microblog_csrf"
    max_post_length: int = 280
    link_preview_timeout: float = 4.0
    link_preview_max_bytes: int = 524288


@lru_cache
def get_settings() -> Settings:
    return Settings()
