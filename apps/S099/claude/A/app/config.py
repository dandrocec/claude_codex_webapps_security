"""Application configuration."""
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Settings loaded from environment variables (optionally a .env file)."""

    model_config = SettingsConfigDict(env_file=".env", env_prefix="IDP_", extra="ignore")

    # The public-facing base URL of this identity provider.
    issuer: str = "http://localhost:5099"

    # Database location.
    database_url: str = f"sqlite:///{BASE_DIR / 'idp.db'}"

    # Secret used to sign browser session cookies.
    session_secret: str = "change-me-in-production-please"

    # Where the RSA signing keypair lives (auto-generated on first run).
    keys_dir: Path = BASE_DIR / "keys"

    # Lifetimes (seconds).
    auth_code_ttl: int = 300          # 5 minutes
    access_token_ttl: int = 3600      # 1 hour
    id_token_ttl: int = 3600          # 1 hour

    # Seeded on first run so the app is usable immediately.
    seed_admin_username: str = "admin"
    seed_admin_password: str = "admin123"
    seed_demo_client: bool = True


settings = Settings()
