"""Password hashing, CSRF tokens, input validation and content sniffing."""
from __future__ import annotations

import re
import secrets
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

from . import config

# Argon2id — a strong, salted, memory-hard password hashing algorithm.
# argon2-cffi generates a unique random salt per password automatically.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# --- CSRF ------------------------------------------------------------------
def generate_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def csrf_tokens_match(session_token: Optional[str], form_token: Optional[str]) -> bool:
    if not session_token or not form_token:
        return False
    # Constant-time comparison to avoid timing oracles.
    return secrets.compare_digest(session_token, form_token)


# --- Input validation ------------------------------------------------------
_USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def validate_username(username: str) -> Optional[str]:
    """Return an error message if invalid, else None."""
    username = (username or "").strip()
    if not _USERNAME_RE.match(username):
        return (
            "Username must be 3–32 characters and contain only letters, "
            "digits, '.', '_' or '-'."
        )
    return None


def validate_password(password: str) -> Optional[str]:
    if password is None or len(password) < 10:
        return "Password must be at least 10 characters long."
    if len(password) > 1024:
        return "Password is too long."
    return None


# --- Upload content inspection --------------------------------------------
def sniff_filetype(data: bytes) -> Optional[str]:
    """Identify a file by inspecting its *content* (magic bytes).

    Returns the allow-list key (e.g. "png") or None if the content does not
    match any permitted type. The client-supplied filename and Content-Type
    are deliberately ignored.
    """
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:5] == b"%PDF-":
        return "pdf"
    # Plain text: must be valid UTF-8 with no NUL/control bytes (other than
    # common whitespace). This keeps the "txt" type from smuggling binaries.
    if _looks_like_text(data):
        return "txt"
    return None


def _looks_like_text(data: bytes) -> bool:
    if not data:
        return False
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return False
    for ch in text:
        codepoint = ord(ch)
        if ch in "\t\n\r":
            continue
        if codepoint < 0x20 or codepoint == 0x7F:
            return False
    return True


def random_stored_name(extension: str) -> str:
    """Server-generated, unguessable filename — never the user's filename."""
    return f"{secrets.token_hex(20)}.{extension}"
