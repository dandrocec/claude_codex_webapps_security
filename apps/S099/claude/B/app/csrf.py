"""Synchroniser-token CSRF protection for state-changing browser requests."""
import secrets

from fastapi import Request

_SESSION_KEY = "csrf_token"


def get_csrf_token(request: Request) -> str:
    token = request.session.get(_SESSION_KEY)
    if not token:
        token = secrets.token_urlsafe(32)
        request.session[_SESSION_KEY] = token
    return token


def validate_csrf(request: Request, submitted: str | None) -> bool:
    expected = request.session.get(_SESSION_KEY)
    if not expected or not submitted:
        return False
    return secrets.compare_digest(str(expected), str(submitted))
