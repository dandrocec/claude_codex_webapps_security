from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, FastAPI, Form, HTTPException, Request, Response, status
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, EmailStr, Field, TypeAdapter
from sqlalchemy import delete, desc, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.db import Base, engine, get_db
from app.models import FeedItem, Follow, LinkPreview, Post, User
from app.security import (
    check_unique_user,
    clean_text,
    create_csrf_token,
    current_user,
    get_or_create_csrf,
    hash_password,
    public_user,
    require_user,
    validate_username,
    verify_password,
)
from app.tasks import enqueue_job


settings = get_settings()
app = FastAPI(title="Microblog", docs_url="/api/docs", redoc_url=None)
app.mount("/static", StaticFiles(directory="app/static"), name="static")
templates = Jinja2Templates(directory="app/templates", autoescape=True)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        try:
            response = await call_next(request)
        except Exception:
            return JSONResponse({"detail": "Internal server error."}, status_code=500)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'self'; frame-ancestors 'none'"
        return response


def secrets_compare(a: str, b: str) -> bool:
    import secrets

    return secrets.compare_digest(a, b)


async def csrf_protect(request: Request) -> None:
    cookie_token = request.cookies.get(settings.csrf_cookie_name)
    submitted_token = request.headers.get("x-csrf-token")
    if submitted_token is None:
        form = await request.form()
        submitted_token = form.get("csrf_token")
    if not cookie_token or not submitted_token or not secrets_compare(cookie_token, str(submitted_token)):
        raise HTTPException(status_code=403, detail="Invalid CSRF token.")


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.secret_key,
    session_cookie=settings.session_cookie_name,
    https_only=settings.session_cookie_secure,
    same_site="strict",
    max_age=60 * 60 * 8,
)


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse({"detail": "Internal server error."}, status_code=500)


@app.exception_handler(HTTPException)
async def handled_http_exception(request: Request, exc: HTTPException) -> Response:
    return await http_exception_handler(request, exc)


def render(request: Request, name: str, context: dict, response: Response | None = None) -> HTMLResponse:
    token = get_or_create_csrf(request, response or Response())
    context.update({"request": request, "csrf_token": token, "viewer": context.get("viewer")})
    html_response = templates.TemplateResponse(name, context)
    if response is not None:
        for header, value in response.headers.items():
            html_response.headers[header] = value
        for cookie in response.raw_headers:
            if cookie[0].lower() == b"set-cookie":
                html_response.raw_headers.append(cookie)
    return html_response


def post_to_dict(post: Post) -> dict:
    return {
        "id": post.id,
        "author": public_user(post.author),
        "body": post.body,
        "created_at": post.created_at.isoformat(),
        "previews": [
            {"url": p.url, "title": p.title, "description": p.description, "status": p.status}
            for p in post.previews
        ],
    }


class RegisterBody(BaseModel):
    username: str = Field(min_length=3, max_length=32)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class LoginBody(BaseModel):
    username: str
    password: str


class PostBody(BaseModel):
    body: str = Field(min_length=1, max_length=280)


@app.get("/", response_class=HTMLResponse)
def home(request: Request, response: Response, db: Annotated[Session, Depends(get_db)]) -> Response:
    viewer = current_user(request, db)
    if viewer is None:
        return render(request, "login.html", {"viewer": None, "error": None}, response)
    posts = timeline_posts(db, viewer.id)
    suggestions = db.scalars(select(User).where(User.id != viewer.id).order_by(User.username).limit(20)).all()
    following = {row[0] for row in db.execute(select(Follow.followed_id).where(Follow.follower_id == viewer.id)).all()}
    return render(request, "timeline.html", {"viewer": viewer, "posts": posts, "suggestions": suggestions, "following": following, "error": None}, response)


@app.post("/register", dependencies=[Depends(csrf_protect)])
def register_form(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    username: Annotated[str, Form()],
    email: Annotated[str, Form()],
    password: Annotated[str, Form()],
) -> Response:
    user = register_user(db, username, email, password)
    request.session["user_id"] = user.id
    response = RedirectResponse("/", status_code=303)
    create_csrf_token(response)
    return response


@app.post("/login", dependencies=[Depends(csrf_protect)])
def login_form(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    username: Annotated[str, Form()],
    password: Annotated[str, Form()],
) -> Response:
    user = authenticate(db, username, password)
    request.session["user_id"] = user.id
    response = RedirectResponse("/", status_code=303)
    create_csrf_token(response)
    return response


@app.post("/logout", dependencies=[Depends(csrf_protect)])
def logout_form(request: Request) -> Response:
    request.session.clear()
    response = RedirectResponse("/", status_code=303)
    create_csrf_token(response)
    return response


@app.post("/posts", dependencies=[Depends(csrf_protect)])
def create_post_form(
    request: Request,
    db: Annotated[Session, Depends(get_db)],
    body: Annotated[str, Form()],
) -> Response:
    viewer = require_user(request, db)
    create_post(db, viewer.id, body)
    return RedirectResponse("/", status_code=303)


@app.post("/follow/{user_id}", dependencies=[Depends(csrf_protect)])
def follow_form(request: Request, user_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    viewer = require_user(request, db)
    follow_user(db, viewer.id, user_id)
    return RedirectResponse("/", status_code=303)


@app.post("/unfollow/{user_id}", dependencies=[Depends(csrf_protect)])
def unfollow_form(request: Request, user_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    viewer = require_user(request, db)
    unfollow_user(db, viewer.id, user_id)
    return RedirectResponse("/", status_code=303)


@app.post("/posts/{post_id}/delete", dependencies=[Depends(csrf_protect)])
def delete_post_form(request: Request, post_id: int, db: Annotated[Session, Depends(get_db)]) -> Response:
    viewer = require_user(request, db)
    delete_post(db, viewer.id, post_id)
    return RedirectResponse("/", status_code=303)


@app.get("/api/csrf")
def api_csrf(request: Request, response: Response) -> dict[str, str]:
    return {"csrf_token": get_or_create_csrf(request, response)}


@app.post("/api/register", dependencies=[Depends(csrf_protect)])
def api_register(request: Request, payload: RegisterBody, db: Annotated[Session, Depends(get_db)]) -> dict:
    user = register_user(db, payload.username, payload.email, payload.password)
    request.session["user_id"] = user.id
    return {"user": public_user(user)}


@app.post("/api/login", dependencies=[Depends(csrf_protect)])
def api_login(request: Request, payload: LoginBody, db: Annotated[Session, Depends(get_db)]) -> dict:
    user = authenticate(db, payload.username, payload.password)
    request.session["user_id"] = user.id
    return {"user": public_user(user)}


@app.post("/api/logout", dependencies=[Depends(csrf_protect)])
def api_logout(request: Request) -> dict[str, bool]:
    request.session.clear()
    return {"ok": True}


@app.get("/api/me")
def api_me(request: Request, db: Annotated[Session, Depends(get_db)]) -> dict:
    user = require_user(request, db)
    return {"user": public_user(user)}


@app.get("/api/users")
def api_users(request: Request, db: Annotated[Session, Depends(get_db)], q: str = "") -> dict:
    require_user(request, db)
    query = select(User).order_by(User.username).limit(50)
    if q:
        safe_q = clean_text(q, max_length=32)
        query = select(User).where(User.username.ilike(f"%{safe_q}%")).order_by(User.username).limit(50)
    return {"users": [public_user(user) for user in db.scalars(query).all()]}


@app.post("/api/posts", dependencies=[Depends(csrf_protect)])
def api_create_post(request: Request, payload: PostBody, db: Annotated[Session, Depends(get_db)]) -> dict:
    viewer = require_user(request, db)
    post = create_post(db, viewer.id, payload.body)
    return {"post": post_to_dict(post)}


@app.delete("/api/posts/{post_id}", dependencies=[Depends(csrf_protect)])
def api_delete_post(request: Request, post_id: int, db: Annotated[Session, Depends(get_db)]) -> dict[str, bool]:
    viewer = require_user(request, db)
    delete_post(db, viewer.id, post_id)
    return {"ok": True}


@app.post("/api/follow/{user_id}", dependencies=[Depends(csrf_protect)])
def api_follow(request: Request, user_id: int, db: Annotated[Session, Depends(get_db)]) -> dict[str, bool]:
    viewer = require_user(request, db)
    follow_user(db, viewer.id, user_id)
    return {"ok": True}


@app.delete("/api/follow/{user_id}", dependencies=[Depends(csrf_protect)])
def api_unfollow(request: Request, user_id: int, db: Annotated[Session, Depends(get_db)]) -> dict[str, bool]:
    viewer = require_user(request, db)
    unfollow_user(db, viewer.id, user_id)
    return {"ok": True}


@app.get("/api/timeline")
def api_timeline(request: Request, db: Annotated[Session, Depends(get_db)]) -> dict:
    viewer = require_user(request, db)
    return {"posts": [post_to_dict(post) for post in timeline_posts(db, viewer.id)]}


def register_user(db: Session, username: str, email: str, password: str) -> User:
    username = validate_username(username)
    email = TypeAdapter(EmailStr).validate_python(email.strip()).lower()
    check_unique_user(db, username, email)
    user = User(username=username, email=email, password_hash=hash_password(password))
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username or email is already registered.")
    db.refresh(user)
    enqueue_job("refresh_feed_for_user", user.id)
    return user


def authenticate(db: Session, username: str, password: str) -> User:
    username = username.strip()
    user = db.scalar(select(User).where(or_(User.username == username, User.email == username.lower())))
    if user is None or not verify_password(password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials.")
    return user


def create_post(db: Session, user_id: int, body: str) -> Post:
    body = clean_text(body, max_length=settings.max_post_length)
    post = Post(author_id=user_id, body=body)
    db.add(post)
    db.commit()
    db.refresh(post, attribute_names=["author", "previews"])
    enqueue_job("fetch_link_previews", post.id)
    enqueue_job("refresh_feeds_for_author", user_id)
    return post


def delete_post(db: Session, user_id: int, post_id: int) -> None:
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found.")
    if post.author_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot modify another user's post.")
    db.execute(delete(FeedItem).where(FeedItem.post_id == post_id))
    db.execute(delete(LinkPreview).where(LinkPreview.post_id == post_id))
    db.delete(post)
    db.commit()
    enqueue_job("refresh_feeds_for_author", user_id)


def follow_user(db: Session, follower_id: int, followed_id: int) -> None:
    if follower_id == followed_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself.")
    if db.get(User, followed_id) is None:
        raise HTTPException(status_code=404, detail="User not found.")
    if db.scalar(select(Follow).where(Follow.follower_id == follower_id, Follow.followed_id == followed_id)):
        return
    db.add(Follow(follower_id=follower_id, followed_id=followed_id))
    db.commit()
    enqueue_job("refresh_feed_for_user", follower_id)


def unfollow_user(db: Session, follower_id: int, followed_id: int) -> None:
    db.execute(delete(Follow).where(Follow.follower_id == follower_id, Follow.followed_id == followed_id))
    db.commit()
    enqueue_job("refresh_feed_for_user", follower_id)


def timeline_posts(db: Session, user_id: int) -> list[Post]:
    post_ids = [row[0] for row in db.execute(select(FeedItem.post_id).where(FeedItem.user_id == user_id).order_by(desc(FeedItem.created_at)).limit(100)).all()]
    if not post_ids:
        enqueue_job("refresh_feed_for_user", user_id)
        post_ids = [row[0] for row in db.execute(select(Post.id).where(Post.author_id == user_id).order_by(desc(Post.created_at)).limit(100)).all()]
    if not post_ids:
        return []
    posts = db.scalars(select(Post).options(selectinload(Post.author), selectinload(Post.previews)).where(Post.id.in_(post_ids))).all()
    by_id = {post.id: post for post in posts}
    return [by_id[post_id] for post_id in post_ids if post_id in by_id]
