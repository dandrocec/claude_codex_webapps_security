import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .database import get_db
from .models import Role, User
from .security import decode_access_token

# Bearer-token auth. In Swagger UI ("/docs") click "Authorize" and paste the
# access_token returned by /auth/login or /auth/signup.
bearer_scheme = HTTPBearer(auto_error=True)

_credentials_exc = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the authenticated user from the bearer token.

    The token binds a user to an org_id; we additionally re-check that the loaded
    user still belongs to that org, so a token can never be used cross-tenant.
    """
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = int(payload["sub"])
        org_id = int(payload["org_id"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _credentials_exc

    user = db.get(User, user_id)
    if user is None or user.org_id != org_id or not user.is_active:
        raise _credentials_exc
    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Guard for endpoints that only an organisation admin may use."""
    if current_user.role != Role.admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organisation admin role required",
        )
    return current_user
