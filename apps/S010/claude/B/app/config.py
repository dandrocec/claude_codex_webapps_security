"""Application configuration loaded from environment variables.

Secrets are never hardcoded. In development a generated secret is used so the
app still runs, but a warning is printed and you should set SECRET_KEY in
production (see .env.example).
"""
from __future__ import annotations

import os
import secrets
from pathlib import Path


def _get_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


# Project paths -------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
# Uploads live OUTSIDE any statically served / importable directory and are
# only ever streamed back through an authenticated endpoint.
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", BASE_DIR / "uploads")).resolve()
DB_PATH = Path(os.environ.get("DB_PATH", BASE_DIR / "data" / "app.db")).resolve()

# Secrets -------------------------------------------------------------------
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    # Allow the app to boot in dev, but make it obvious this is ephemeral:
    # sessions will be invalidated on every restart.
    SECRET_KEY = secrets.token_urlsafe(48)
    print(
        "[WARNING] SECRET_KEY not set; using a random ephemeral key. "
        "Set SECRET_KEY in the environment for stable sessions / production."
    )

# Cookie / session settings -------------------------------------------------
# Secure must be True in production (HTTPS). For local plain-HTTP testing on
# port 5010 it defaults to False so the cookie is actually sent by the browser.
COOKIE_SECURE = _get_bool("COOKIE_SECURE", False)
SESSION_COOKIE_NAME = "session"
SESSION_MAX_AGE = int(os.environ.get("SESSION_MAX_AGE", 60 * 60 * 8))  # 8 hours

# Upload policy -------------------------------------------------------------
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", 5 * 1024 * 1024))  # 5 MiB

# Allow-list of accepted types. The key is validated against *inspected file
# content* (magic bytes), never the client-supplied filename or Content-Type.
ALLOWED_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "pdf": "application/pdf",
    "txt": "text/plain; charset=utf-8",
}

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", 5010))
