"""JSON REST API."""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..database import get_db
from ..deps import csrf_protect, get_current_user, get_session, require_user
from ..models import Session as SessionModel, User
from ..schemas import LoginIn, PostIn, PostOut, PreviewOut, RegisterIn, UserOut
from ..security import hash_password, new_token, verify_password
from .. import services

router = APIRouter(prefix="/api")


def _serialize_post(post) -> PostOut:
    return PostOut(
        id=post.id,
        content=post.content,
        created_at=post.created_at,
        author=UserOut.model_validate(post.author),
        previews=[PreviewOut.model_validate(p) for p in post.previews],
    )


@router.get("/csrf")
def get_csrf(session: SessionModel = Depends(get_session)):
    """Return the CSRF token for the current session (read it before POSTing)."""
    return {"csrf_token": session.csrf_token}


@router.get("/me")
def me(user: User | None = Depends(get_current_user)):
    if user is None:
        return {"authenticated": False}
    return {"authenticated": True, "user": UserOut.model_validate(user).model_dump()}


@router.post("/register", status_code=status.HTTP_201_CREATED, dependencies=[Depends(csrf_protect)])
def register(payload: RegisterIn, db: OrmSession = Depends(get_db)):
    user = services.create_user(db, payload.username, hash_password(payload.password))
    return {"user": UserOut.model_validate(user).model_dump()}


def _login_session(request: Request, db: OrmSession, user: User) -> None:
    """Rotate the current session and bind it to the user (fixation prevention)."""
    token = request.state.session_token
    session = db.query(SessionModel).filter(SessionModel.token == token).first()
    if session is None:
        session = SessionModel(
            token=new_token(),
            csrf_token=new_token(),
            expires_at=datetime.utcnow() + timedelta(hours=settings.SESSION_TTL_HOURS),
        )
        db.add(session)
    session.user_id = user.id
    session.token = new_token()
    session.csrf_token = new_token()
    session.expires_at = datetime.utcnow() + timedelta(hours=settings.SESSION_TTL_HOURS)
    db.commit()
    request.state.new_session_token = session.token


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )


@router.post("/login", dependencies=[Depends(csrf_protect)])
def login(payload: LoginIn, request: Request, response: Response, db: OrmSession = Depends(get_db)):
    user = services.get_user_by_username(db, payload.username)
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    _login_session(request, db, user)
    _set_session_cookie(response, request.state.new_session_token)
    return {"user": UserOut.model_validate(user).model_dump()}


@router.post("/logout", dependencies=[Depends(csrf_protect)])
def logout(request: Request, response: Response, db: OrmSession = Depends(get_db)):
    token = request.state.session_token
    session = db.query(SessionModel).filter(SessionModel.token == token).first()
    if session is not None:
        db.delete(session)
        db.commit()
    response.delete_cookie(settings.COOKIE_NAME, path="/")
    return {"ok": True}


@router.post("/posts", status_code=status.HTTP_201_CREATED, dependencies=[Depends(csrf_protect)])
def create_post(payload: PostIn, db: OrmSession = Depends(get_db), user: User = Depends(require_user)):
    post = services.create_post(db, user, payload.content)
    return _serialize_post(post).model_dump()


@router.get("/posts/{post_id}")
def get_post(post_id: int, db: OrmSession = Depends(get_db)):
    from ..models import Post

    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize_post(post).model_dump()


@router.delete("/posts/{post_id}", dependencies=[Depends(csrf_protect)])
def delete_post(post_id: int, db: OrmSession = Depends(get_db), user: User = Depends(require_user)):
    services.delete_post(db, user, post_id)
    return {"ok": True}


@router.get("/timeline")
def timeline(
    db: OrmSession = Depends(get_db),
    user: User = Depends(require_user),
    limit: int = 50,
    offset: int = 0,
):
    posts = services.get_timeline(db, user, limit=limit, offset=offset)
    return {"posts": [_serialize_post(p).model_dump() for p in posts]}


@router.get("/users/{username}")
def get_user(username: str, db: OrmSession = Depends(get_db)):
    target = services.get_user_by_username(db, username)
    if target is None:
        raise HTTPException(status_code=404, detail="User not found")
    posts = services.get_user_posts(db, target)
    return {
        "user": UserOut.model_validate(target).model_dump(),
        "posts": [_serialize_post(p).model_dump() for p in posts],
    }


@router.post("/users/{username}/follow", dependencies=[Depends(csrf_protect)])
def follow(username: str, db: OrmSession = Depends(get_db), user: User = Depends(require_user)):
    services.follow_user(db, user, username)
    return {"ok": True}


@router.delete("/users/{username}/follow", dependencies=[Depends(csrf_protect)])
def unfollow(username: str, db: OrmSession = Depends(get_db), user: User = Depends(require_user)):
    services.unfollow_user(db, user, username)
    return {"ok": True}
