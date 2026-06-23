"""Authentication, authorisation, and CSRF dependencies."""
from __future__ import annotations

import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from . import crud, models
from .database import get_db
from .security import csrf_tokens_match, decode_access_token

ACCESS_COOKIE = "access_token"
CSRF_COOKIE = "csrf_token"
CSRF_HEADER = "x-csrf-token"

_UNAUTHORIZED = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Not authenticated",
    headers={"WWW-Authenticate": "Bearer"},
)


def _extract_token(request: Request) -> tuple[str | None, bool]:
    """Return (token, from_cookie). Bearer header takes precedence."""
    auth = request.headers.get("authorization")
    if auth and auth.lower().startswith("bearer "):
        return auth[7:].strip(), False
    cookie = request.cookies.get(ACCESS_COOKIE)
    if cookie:
        return cookie, True
    return None, False


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> models.User:
    token, _ = _extract_token(request)
    if not token:
        raise _UNAUTHORIZED
    try:
        payload = decode_access_token(token)
    except jwt.PyJWTError:
        raise _UNAUTHORIZED
    username = payload.get("sub")
    if not username:
        raise _UNAUTHORIZED
    user = crud.get_user_by_username(db, username)
    if user is None:
        raise _UNAUTHORIZED
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != models.Role.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required"
        )
    return user


def csrf_protect(
    request: Request,
    x_csrf_token: str | None = Header(default=None),
) -> None:
    """Double-submit CSRF check for cookie-authenticated, state-changing requests.

    Requests authenticated purely with a Bearer token are not browser-driven and
    are exempt; cookie-authenticated requests must echo the CSRF cookie value in
    the X-CSRF-Token header.
    """
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return  # not vulnerable to CSRF; no ambient cookie used for auth

    if ACCESS_COOKIE not in request.cookies:
        return  # not cookie-authenticated; auth layer will reject if needed

    cookie_token = request.cookies.get(CSRF_COOKIE)
    if not csrf_tokens_match(cookie_token, x_csrf_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="CSRF token missing or invalid"
        )
