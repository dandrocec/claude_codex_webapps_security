"""Input validation helpers. All user input is validated before use."""
import re

from email_validator import validate_email, EmailNotValidError

USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,64}$")
CLIENT_NAME_RE = re.compile(r"^[A-Za-z0-9 _.\-]{3,128}$")
MIN_PASSWORD_LEN = 10
MAX_PASSWORD_LEN = 256


def validate_username(value: str) -> tuple[str | None, str | None]:
    value = (value or "").strip()
    if not USERNAME_RE.match(value):
        return None, "Username must be 3-64 chars: letters, digits, and . _ -"
    return value, None


def validate_user_email(value: str) -> tuple[str | None, str | None]:
    value = (value or "").strip()
    try:
        result = validate_email(value, check_deliverability=False)
        return result.normalized, None
    except EmailNotValidError:
        return None, "Enter a valid email address."


def validate_password(value: str) -> tuple[str | None, str | None]:
    value = value or ""
    if len(value) < MIN_PASSWORD_LEN:
        return None, f"Password must be at least {MIN_PASSWORD_LEN} characters."
    if len(value) > MAX_PASSWORD_LEN:
        return None, "Password is too long."
    return value, None


def validate_client_name(value: str) -> tuple[str | None, str | None]:
    value = (value or "").strip()
    if not CLIENT_NAME_RE.match(value):
        return None, "Client name must be 3-128 chars (letters, digits, spaces, . _ -)."
    return value, None


def validate_redirect_uris(value: str) -> tuple[list[str] | None, str | None]:
    """Each redirect URI must be an absolute http(s) URL with no fragment."""
    raw = [u.strip() for u in (value or "").splitlines() if u.strip()]
    if not raw:
        return None, "At least one redirect URI is required."
    if len(raw) > 10:
        return None, "Too many redirect URIs (max 10)."
    cleaned = []
    for uri in raw:
        if not re.match(r"^https?://[^\s]+$", uri) or "#" in uri:
            return None, f"Invalid redirect URI: {uri}"
        if len(uri) > 2000:
            return None, "Redirect URI is too long."
        cleaned.append(uri)
    return cleaned, None
