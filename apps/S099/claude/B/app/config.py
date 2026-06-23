"""Application configuration. Secrets are read from environment variables only."""
import os
import secrets
import logging
from functools import lru_cache

log = logging.getLogger("idp.config")


def _as_bool(value: str) -> bool:
    return str(value).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "sqlite:///./idp.db")

        env_secret = os.getenv("SESSION_SECRET")
        self.session_secret_from_env = bool(env_secret)
        if env_secret:
            self.session_secret = env_secret
        else:
            # Ephemeral secret keeps the app runnable without leaking a hardcoded
            # value. Existing sessions are invalidated whenever the process restarts.
            self.session_secret = secrets.token_urlsafe(48)
            log.warning(
                "SESSION_SECRET not set; using an ephemeral secret. "
                "Set SESSION_SECRET in the environment for stable sessions."
            )

        self.cookie_secure = _as_bool(os.getenv("COOKIE_SECURE", "false"))
        self.issuer = os.getenv("ISSUER", "http://localhost:5099").rstrip("/")
        self.access_token_ttl = int(os.getenv("ACCESS_TOKEN_TTL", "3600"))
        self.id_token_ttl = int(os.getenv("ID_TOKEN_TTL", "3600"))
        self.auth_code_ttl = int(os.getenv("AUTH_CODE_TTL", "300"))
        self.keys_dir = os.getenv("KEYS_DIR", "./keys")
        self.private_key_pem = os.getenv("PRIVATE_KEY_PEM")

        self.admin_username = os.getenv("ADMIN_USERNAME")
        self.admin_password = os.getenv("ADMIN_PASSWORD")
        self.admin_email = os.getenv("ADMIN_EMAIL", "admin@example.com")


@lru_cache
def get_settings() -> Settings:
    return Settings()
