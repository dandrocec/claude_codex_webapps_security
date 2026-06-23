"""FastAPI application: REST API + minimal server-rendered UI."""
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.requests import Request

from . import schemas
from .database import get_db, init_db
from .jobs import enqueue
from .models import FeedItem, Follow, LinkPreview, Post, User
from .worker import start_in_thread

BASE_DIR = Path(__file__).resolve().parent
templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))

app = FastAPI(title="Microblog", version="1.0.0")


@app.on_event("startup")
def _on_startup():
    init_db()
    _seed_if_empty()
    if os.environ.get("RUN_WORKER_INLINE", "1") == "1":
        start_in_thread()


def _seed_if_empty():
    from .database import SessionLocal

    db = SessionLocal()
    try:
        if db.query(User).count() == 0:
            db.add_all([User(username=n) for n in ("alice", "bob", "carol")])
            db.commit()
    finally:
        db.close()


# --------------------------------------------------------------------------- #
# Serialization helpers
# --------------------------------------------------------------------------- #
def _serialize_post(post: Post) -> schemas.PostOut:
    return schemas.PostOut(
        id=post.id,
        author_id=post.author_id,
        author_username=post.author.username if post.author else None,
        content=post.content,
        created_at=post.created_at,
        previews=[schemas.LinkPreviewOut.model_validate(p) for p in post.previews],
    )


def _get_user_or_404(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# --------------------------------------------------------------------------- #
# Users
# --------------------------------------------------------------------------- #
@app.post("/api/users", response_model=schemas.UserOut, status_code=201)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    user = User(username=payload.username.strip())
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Username already taken")
    db.refresh(user)
    return user


@app.get("/api/users", response_model=list[schemas.UserOut])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.username).all()


@app.get("/api/users/{user_id}", response_model=schemas.UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    return _get_user_or_404(db, user_id)


@app.get("/api/users/{user_id}/following", response_model=list[schemas.UserOut])
def list_following(user_id: int, db: Session = Depends(get_db)):
    _get_user_or_404(db, user_id)
    rows = (
        db.query(User)
        .join(Follow, Follow.followee_id == User.id)
        .filter(Follow.follower_id == user_id)
        .order_by(User.username)
        .all()
    )
    return rows


@app.post("/api/users/{user_id}/follow", status_code=201)
def follow(
    user_id: int, payload: schemas.FollowCreate, db: Session = Depends(get_db)
):
    _get_user_or_404(db, user_id)
    _get_user_or_404(db, payload.target_id)
    if user_id == payload.target_id:
        raise HTTPException(status_code=400, detail="Cannot follow yourself")
    exists = (
        db.query(Follow)
        .filter(
            Follow.follower_id == user_id,
            Follow.followee_id == payload.target_id,
        )
        .first()
    )
    if exists:
        return {"status": "already-following"}
    db.add(Follow(follower_id=user_id, followee_id=payload.target_id))
    db.commit()

    # Backfill the new follower's timeline with the followee's recent posts.
    recent = (
        db.query(Post)
        .filter(Post.author_id == payload.target_id)
        .order_by(Post.created_at.desc())
        .limit(50)
        .all()
    )
    for post in recent:
        already = (
            db.query(FeedItem)
            .filter(FeedItem.user_id == user_id, FeedItem.post_id == post.id)
            .first()
        )
        if not already:
            db.add(
                FeedItem(
                    user_id=user_id, post_id=post.id, created_at=post.created_at
                )
            )
    db.commit()
    return {"status": "following"}


@app.delete("/api/users/{user_id}/follow/{target_id}")
def unfollow(user_id: int, target_id: int, db: Session = Depends(get_db)):
    deleted = (
        db.query(Follow)
        .filter(
            Follow.follower_id == user_id, Follow.followee_id == target_id
        )
        .delete()
    )
    # Remove the unfollowed author's posts from the timeline.
    db.query(FeedItem).filter(
        FeedItem.user_id == user_id,
        FeedItem.post_id.in_(
            db.query(Post.id).filter(Post.author_id == target_id)
        ),
    ).delete(synchronize_session=False)
    db.commit()
    return {"status": "unfollowed", "removed": deleted}


# --------------------------------------------------------------------------- #
# Posts
# --------------------------------------------------------------------------- #
@app.post("/api/posts", response_model=schemas.PostOut, status_code=201)
def create_post(payload: schemas.PostCreate, db: Session = Depends(get_db)):
    _get_user_or_404(db, payload.author_id)
    post = Post(author_id=payload.author_id, content=payload.content)
    db.add(post)
    db.flush()
    # Queue background work: fan out to timelines + fetch link previews.
    enqueue(db, "fanout_post", {"post_id": post.id})
    enqueue(db, "fetch_link_preview", {"post_id": post.id})
    db.commit()
    db.refresh(post)
    return _serialize_post(post)


@app.get("/api/posts/{post_id}", response_model=schemas.PostOut)
def get_post(post_id: int, db: Session = Depends(get_db)):
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=404, detail="Post not found")
    return _serialize_post(post)


@app.get("/api/users/{user_id}/posts", response_model=list[schemas.PostOut])
def user_posts(user_id: int, db: Session = Depends(get_db)):
    _get_user_or_404(db, user_id)
    posts = (
        db.query(Post)
        .filter(Post.author_id == user_id)
        .order_by(Post.created_at.desc())
        .all()
    )
    return [_serialize_post(p) for p in posts]


@app.get("/api/timeline/{user_id}", response_model=list[schemas.PostOut])
def timeline(user_id: int, limit: int = 50, db: Session = Depends(get_db)):
    """Return the materialized per-user feed built by the worker."""
    _get_user_or_404(db, user_id)
    posts = (
        db.query(Post)
        .join(FeedItem, FeedItem.post_id == Post.id)
        .filter(FeedItem.user_id == user_id)
        .order_by(FeedItem.created_at.desc())
        .limit(min(limit, 200))
        .all()
    )
    return [_serialize_post(p) for p in posts]


# --------------------------------------------------------------------------- #
# UI
# --------------------------------------------------------------------------- #
@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
