"""Server-rendered HTML UI. Jinja2 autoescaping provides context-aware output
encoding (XSS prevention); all state-changing routes require a CSRF token."""
from __future__ import annotations

from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, Form, Request, Response, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session as OrmSession

from ..config import settings
from ..database import get_db
from ..deps import csrf_protect, get_current_user, get_session
from ..models import Session as SessionModel, User
from ..schemas import LoginIn, PostIn, RegisterIn
from ..security import hash_password, new_token, verify_password
from .. import services

router = APIRouter()
templates = Jinja2Templates(directory=str(Path(__file__).resolve().parent.parent / "templates"))


def _ctx(request: Request, user: User | None, **extra) -> dict:
    base = {
        "request": request,
        "current_user": user,
        "csrf_token": getattr(request.state, "csrf_token", ""),
        "error": request.query_params.get("error"),
        "notice": request.query_params.get("notice"),
    }
    base.update(extra)
    return base


def _redirect(url: str) -> RedirectResponse:
    return RedirectResponse(url=url, status_code=status.HTTP_303_SEE_OTHER)


@router.get("/", response_class=HTMLResponse)
def index(request: Request, db: OrmSession = Depends(get_db), user: User | None = Depends(get_current_user)):
    if user is None:
        return templates.TemplateResponse("landing.html", _ctx(request, None))
    posts = services.get_timeline(db, user)
    return templates.TemplateResponse("timeline.html", _ctx(request, user, posts=posts))


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request, user: User | None = Depends(get_current_user)):
    if user is not None:
        return _redirect("/")
    return templates.TemplateResponse("login.html", _ctx(request, None))


@router.get("/register", response_class=HTMLResponse)
def register_page(request: Request, user: User | None = Depends(get_current_user)):
    if user is not None:
        return _redirect("/")
    return templates.TemplateResponse("register.html", _ctx(request, None))


def _bind_session_to_user(request: Request, db: OrmSession, user: User) -> str:
    """Rotate session token + csrf and attach the user (fixation prevention)."""
    token = request.state.session_token
    session = db.query(SessionModel).filter(SessionModel.token == token).first()
    if session is None:
        session = SessionModel(token=new_token(), csrf_token=new_token(),
                               expires_at=datetime.utcnow())
        db.add(session)
    session.user_id = user.id
    session.token = new_token()
    session.csrf_token = new_token()
    session.expires_at = datetime.utcnow() + timedelta(hours=settings.SESSION_TTL_HOURS)
    db.commit()
    return session.token


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        max_age=settings.SESSION_TTL_HOURS * 3600,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        path="/",
    )


@router.post("/register", dependencies=[Depends(csrf_protect)])
def register_submit(
    request: Request,
    username: str = Form(...),
    password: str = Form(...),
    db: OrmSession = Depends(get_db),
):
    try:
        data = RegisterIn(username=username, password=password)
    except ValueError:
        return _redirect("/register?error=invalid")
    services.create_user(db, data.username, hash_password(data.password))
    return _redirect("/login?notice=registered")


@router.post("/login")
def login_submit(
    request: Request,
    response: Response,
    username: str = Form(...),
    password: str = Form(...),
    csrf_token: str = Form(...),
    db: OrmSession = Depends(get_db),
    session: SessionModel = Depends(get_session),
):
    from ..security import constant_time_equals

    if not constant_time_equals(csrf_token, session.csrf_token):
        return _redirect("/login?error=csrf")
    try:
        data = LoginIn(username=username, password=password)
    except ValueError:
        return _redirect("/login?error=invalid")
    user = services.get_user_by_username(db, data.username)
    if user is None or not verify_password(data.password, user.password_hash):
        return _redirect("/login?error=credentials")
    new_session_token = _bind_session_to_user(request, db, user)
    redirect = _redirect("/")
    _set_cookie(redirect, new_session_token)
    return redirect


@router.post("/logout", dependencies=[Depends(csrf_protect)])
def logout_submit(request: Request, db: OrmSession = Depends(get_db)):
    token = request.state.session_token
    session = db.query(SessionModel).filter(SessionModel.token == token).first()
    if session is not None:
        db.delete(session)
        db.commit()
    redirect = _redirect("/")
    redirect.delete_cookie(settings.COOKIE_NAME, path="/")
    return redirect


@router.post("/compose", dependencies=[Depends(csrf_protect)])
def compose(
    request: Request,
    content: str = Form(...),
    db: OrmSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    if user is None:
        return _redirect("/login")
    try:
        data = PostIn(content=content)
    except ValueError:
        return _redirect("/?error=invalid")
    services.create_post(db, user, data.content)
    return _redirect("/?notice=posted")


@router.post("/posts/{post_id}/delete", dependencies=[Depends(csrf_protect)])
def delete_post(
    post_id: int,
    db: OrmSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    if user is None:
        return _redirect("/login")
    services.delete_post(db, user, post_id)  # enforces ownership (IDOR-safe)
    return _redirect("/?notice=deleted")


@router.get("/u/{username}", response_class=HTMLResponse)
def profile(
    username: str,
    request: Request,
    db: OrmSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    target = services.get_user_by_username(db, username)
    if target is None:
        return templates.TemplateResponse(
            "notfound.html", _ctx(request, user), status_code=404
        )
    posts = services.get_user_posts(db, target)
    following = bool(user and user.id != target.id and services.is_following(db, user.id, target.id))
    can_follow = bool(user and user.id != target.id)
    return templates.TemplateResponse(
        "profile.html",
        _ctx(request, user, profile_user=target, posts=posts,
             following=following, can_follow=can_follow),
    )


@router.post("/u/{username}/follow", dependencies=[Depends(csrf_protect)])
def follow(
    username: str,
    db: OrmSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    if user is None:
        return _redirect("/login")
    services.follow_user(db, user, username)
    return _redirect(f"/u/{username}?notice=followed")


@router.post("/u/{username}/unfollow", dependencies=[Depends(csrf_protect)])
def unfollow(
    username: str,
    db: OrmSession = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    if user is None:
        return _redirect("/login")
    services.unfollow_user(db, user, username)
    return _redirect(f"/u/{username}?notice=unfollowed")
