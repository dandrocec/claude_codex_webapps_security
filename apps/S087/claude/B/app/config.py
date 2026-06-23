"""Application configuration.

All secrets and environment-specific values are read from environment
variables (never hardcoded). A local `.env` file is loaded for convenience
during development.
"""
import os
from functools import lru_cache

from dotenv import load_dotenv

# Load variables from a local .env file if present. Real secrets in
# production should be injected by the platform, not committed to disk.
load_dotenv()


class Settings:
    def __init__(self) -> None:
        # SECRET_KEY is mandatory. We refuse to start without it rather than
        # falling back to an insecure default.
        secret_key = os.environ.get("SECRET_KEY")
        if not secret_key or len(secret_key) < 32:
            raise RuntimeError(
                "SECRET_KEY environment variable must be set to a strong, "
                "random value of at least 32 characters. See README / .env.example."
            )
        self.secret_key: str = secret_key

        # Database connection string. Defaults to a local SQLite file so the
        # app is runnable out of the box; override with Postgres/MySQL in prod.
        self.database_url: str = os.environ.get("DATABASE_URL", "sqlite:///./app.db")

        # When True the session cookie gets the Secure flag (HTTPS only).
        # Default True for safety; set to false for plain-HTTP local dev.
        self.session_cookie_secure: bool = (
            os.environ.get("SESSION_COOKIE_SECURE", "true").lower() == "true"
        )

        self.environment: str = os.environ.get("ENVIRONMENT", "development")

    @property
    def debug(self) -> bool:
        return self.environment.lower() == "development"


@lru_cache
def get_settings() -> Settings:
    return Settings()
