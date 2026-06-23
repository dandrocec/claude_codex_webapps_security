"""Reusable FastAPI dependencies: current user/session, auth and CSRF guards."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as OrmSession

from .database import get_db
from .models import Session as SessionModel, User
from .security import constant_time_equals


def get_session(request: Request, db: OrmSession = Depends(get_db)) -> SessionModel:
    """Return the server-side session attached by the session middleware.

    The middleware guarantees a session always exists (anonymous or logged-in).
    """
    token = getattr(request.state, "session_token", None)
    session = None
    if token:
        session = db.query(SessionModel).filter(SessionModel.token == token).first()
    if session is None:
        # Should not happen because the middleware creates one, but never trust it.
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No session")
    return session


def get_current_user(
    session: SessionModel = Depends(get_session), db: OrmSession = Depends(get_db)
) -> User | None:
    if session.user_id is None:
        return None
    return db.get(User, session.user_id)


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required"
        )
    return user


async def csrf_protect(
    request: Request, session: SessionModel = Depends(get_session)
) -> None:
    """Validate a CSRF token for any state-changing request.

    Accepts the token from the `X-CSRF-Token` header (API clients) or a
    `csrf_token` form field (HTML forms). Starlette caches the parsed form, so
    reading it here does not prevent the route from reading it again.
    """
    token = request.headers.get("X-CSRF-Token")
    if not token:
        content_type = request.headers.get("content-type", "")
        if "form" in content_type:
            form = await request.form()
            value = form.get("csrf_token")
            token = value if isinstance(value, str) else None

    if not constant_time_equals(token, session.csrf_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed"
        )
