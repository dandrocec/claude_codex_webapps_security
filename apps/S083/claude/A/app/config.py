from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, overridable via environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database
    database_url: str = "sqlite:///./blog.db"

    # JWT
    secret_key: str = "CHANGE-ME-IN-PRODUCTION-use-a-long-random-string"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60

    # Seed demo accounts on first run so the API is usable immediately.
    seed_demo_data: bool = True


settings = Settings()
