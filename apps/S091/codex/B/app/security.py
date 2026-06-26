import re
import secrets
from typing import Any

import bleach
from fastapi import HTTPException, Request, Response, status
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import User


pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
USERNAME_RE = re.compile(r"^[a-zA-Z0-9_]{3,32}$")
URL_RE = re.compile(r"https?://[^\s<>'\"]+", re.IGNORECASE)


def hash_password(password: str) -> str:
    validate_password(password)
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)


def validate_password(password: str) -> None:
    if len(password) < 12 or len(password) > 128:
        raise HTTPException(status_code=400, detail="Password must be 12 to 128 characters.")


def validate_username(username: str) -> str:
    username = username.strip()
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Username must be 3-32 letters, numbers, or underscores.")
    return username


def clean_text(value: str, *, max_length: int) -> str:
    cleaned = bleach.clean(value.strip(), tags=[], attributes={}, strip=True)
    cleaned = re.sub(r"\s+", " ", cleaned)
    if not cleaned:
        raise HTTPException(status_code=400, detail="Value cannot be empty.")
    if len(cleaned) > max_length:
        raise HTTPException(status_code=400, detail=f"Value cannot exceed {max_length} characters.")
    return cleaned


def extract_urls(text: str) -> list[str]:
    urls = []
    for match in URL_RE.finditer(text):
        url = match.group(0).rstrip(".,);]")
        if url not in urls:
            urls.append(url)
    return urls[:5]


def current_user(request: Request, db: Session) -> User | None:
    user_id = request.session.get("user_id")
    if not isinstance(user_id, int):
        return None
    return db.get(User, user_id)


def require_user(request: Request, db: Session) -> User:
    user = current_user(request, db)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required.")
    return user


def create_csrf_token(response: Response | None = None) -> str:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    if response is not None:
        response.set_cookie(
            settings.csrf_cookie_name,
            token,
            httponly=False,
            secure=settings.session_cookie_secure,
            samesite="strict",
            max_age=60 * 60 * 8,
        )
    return token


def get_or_create_csrf(request: Request, response: Response) -> str:
    settings = get_settings()
    token = request.cookies.get(settings.csrf_cookie_name)
    if not token:
        token = create_csrf_token(response)
    return token


def csrf_from_request(request: Request) -> str | None:
    return request.headers.get("x-csrf-token") or request.query_params.get("csrf_token")


def check_unique_user(db: Session, username: str, email: str) -> None:
    exists = db.scalar(select(User).where((User.username == username) | (User.email == email.lower())))
    if exists:
        raise HTTPException(status_code=409, detail="Username or email is already registered.")


def public_user(user: User) -> dict[str, Any]:
    return {"id": user.id, "username": user.username, "created_at": user.created_at.isoformat()}
