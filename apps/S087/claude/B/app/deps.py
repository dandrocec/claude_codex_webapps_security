"""Request-scoped dependencies for authentication and authorisation."""
from fastapi import Depends, Form, Request
from sqlalchemy.orm import Session

from .database import get_db
from .models import User
from .security import validate_csrf_token


class NotAuthenticated(Exception):
    """Raised when an unauthenticated user hits a protected route."""


class Forbidden(Exception):
    """Raised when an authenticated user lacks permission."""


class CSRFError(Exception):
    """Raised when a state-changing request has a missing/invalid CSRF token."""


def get_current_user(
    request: Request, db: Session = Depends(get_db)
) -> User | None:
    """Return the logged-in user, or None. Scoped by both id and org_id."""
    user_id = request.session.get("user_id")
    org_id = request.session.get("org_id")
    if not user_id or not org_id:
        return None
    # The org_id is pinned in the session at login; we re-check it on every
    # request so a tampered/stale session cannot cross tenant boundaries.
    user = (
        db.query(User)
        .filter(User.id == user_id, User.org_id == org_id)
        .first()
    )
    return user


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise NotAuthenticated()
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if not user.is_admin:
        raise Forbidden()
    return user


def verify_csrf(request: Request, csrf_token: str = Form(default="")) -> None:
    """Dependency enforcing CSRF protection on state-changing requests."""
    if not validate_csrf_token(request.session, csrf_token):
        raise CSRFError()
