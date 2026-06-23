from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration, overridable via environment variables or a .env file."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Database. Defaults to a local SQLite file so the app runs with zero setup.
    database_url: str = "sqlite:///./app.db"

    # JWT signing. CHANGE THIS in any real deployment.
    secret_key: str = "dev-secret-change-me-please-0123456789"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24  # 1 day


settings = Settings()
