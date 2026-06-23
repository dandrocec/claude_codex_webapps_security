"""Authentication endpoints: login and logout."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..config import settings
from ..database import get_db
from ..deps import ACCESS_COOKIE, CSRF_COOKIE, get_current_user
from ..security import (
    create_access_token,
    generate_csrf_token,
    needs_rehash,
    hash_password,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _set_auth_cookies(response: Response, token: str, csrf_token: str) -> None:
    max_age = settings.access_token_expire_minutes * 60
    # JWT cookie: not readable by JS.
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )
    # CSRF cookie: readable by JS so the client can echo it in a header
    # (double-submit pattern). Not HttpOnly by design.
    response.set_cookie(
        key=CSRF_COOKIE,
        value=csrf_token,
        max_age=max_age,
        httponly=False,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/",
    )


@router.post("/login", response_model=schemas.TokenResponse)
def login(
    credentials: schemas.LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> schemas.TokenResponse:
    user = crud.get_user_by_username(db, credentials.username)

    # Constant-ish work whether or not the user exists, and a single generic
    # error to avoid username enumeration.
    if user is None or not verify_password(credentials.password, user.password_hash):
        if user is None:
            # Spend comparable time so timing doesn't reveal valid usernames.
            hash_password(credentials.password)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )

    # Transparently upgrade the stored hash if Argon2 parameters changed.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(credentials.password)
        db.commit()

    token = create_access_token(subject=user.username, role=user.role.value)
    csrf_token = generate_csrf_token()
    _set_auth_cookies(response, token, csrf_token)

    return schemas.TokenResponse(access_token=token, csrf_token=csrf_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, _: object = Depends(get_current_user)) -> Response:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    response.status_code = status.HTTP_204_NO_CONTENT
    return response


@router.get("/me", response_model=schemas.UserOut)
def me(user=Depends(get_current_user)) -> schemas.UserOut:
    return user
