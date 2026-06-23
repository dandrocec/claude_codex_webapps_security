"""Business logic shared by the REST API and the HTML UI."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession, selectinload

from .models import Follow, LinkPreview, Post, User
from .security import extract_urls
from .config import settings
from . import tasks


class ServiceError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def get_user_by_username(db: OrmSession, username: str) -> User | None:
    return db.execute(select(User).where(User.username == username)).scalar_one_or_none()


def create_user(db: OrmSession, username: str, password_hash: str) -> User:
    if get_user_by_username(db, username) is not None:
        raise ServiceError("Username already taken", 409)
    user = User(username=username, password_hash=password_hash)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_post(db: OrmSession, author: User, content: str) -> Post:
    post = Post(author_id=author.id, content=content)
    db.add(post)
    db.commit()
    db.refresh(post)

    # Register pending link previews (fetched safely by the worker).
    for url in extract_urls(content, settings.LINK_PREVIEW_MAX_PER_POST):
        preview = LinkPreview(post_id=post.id, url=url[:2048], status="pending")
        db.add(preview)
    db.commit()

    # Enqueue background work: fan out to feeds + fetch each preview.
    tasks.enqueue(db, "fanout", {"post_id": post.id})
    for preview in post.previews:
        tasks.enqueue(db, "link_preview", {"preview_id": preview.id})
    return post


def delete_post(db: OrmSession, user: User, post_id: int) -> None:
    post = db.get(Post, post_id)
    if post is None:
        raise ServiceError("Post not found", 404)
    # Access control: only the author may delete their post (IDOR prevention).
    if post.author_id != user.id:
        raise ServiceError("Not found", 404)
    db.delete(post)
    db.commit()


def follow_user(db: OrmSession, follower: User, username: str) -> None:
    target = get_user_by_username(db, username)
    if target is None:
        raise ServiceError("User not found", 404)
    if target.id == follower.id:
        raise ServiceError("You cannot follow yourself", 400)
    existing = db.execute(
        select(Follow).where(
            Follow.follower_id == follower.id, Follow.followee_id == target.id
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(Follow(follower_id=follower.id, followee_id=target.id))
        db.commit()
        tasks.enqueue(
            db, "backfill", {"follower_id": follower.id, "followee_id": target.id}
        )


def unfollow_user(db: OrmSession, follower: User, username: str) -> None:
    target = get_user_by_username(db, username)
    if target is None:
        raise ServiceError("User not found", 404)
    existing = db.execute(
        select(Follow).where(
            Follow.follower_id == follower.id, Follow.followee_id == target.id
        )
    ).scalar_one_or_none()
    if existing is not None:
        db.delete(existing)
        db.commit()


def is_following(db: OrmSession, follower_id: int, followee_id: int) -> bool:
    return (
        db.execute(
            select(Follow.id).where(
                Follow.follower_id == follower_id, Follow.followee_id == followee_id
            )
        ).first()
        is not None
    )


def get_timeline(db: OrmSession, user: User, limit: int = 50, offset: int = 0) -> list[Post]:
    """Read the materialised per-user feed produced by the fan-out worker."""
    from .models import FeedEntry

    stmt = (
        select(Post)
        .join(FeedEntry, FeedEntry.post_id == Post.id)
        .where(FeedEntry.user_id == user.id)
        .order_by(FeedEntry.created_at.desc(), Post.id.desc())
        .limit(min(limit, 100))
        .offset(max(offset, 0))
        .options(selectinload(Post.author), selectinload(Post.previews))
    )
    return list(db.execute(stmt).scalars().all())


def get_user_posts(db: OrmSession, user: User, limit: int = 50) -> list[Post]:
    stmt = (
        select(Post)
        .where(Post.author_id == user.id)
        .order_by(Post.created_at.desc())
        .limit(min(limit, 100))
        .options(selectinload(Post.author), selectinload(Post.previews))
    )
    return list(db.execute(stmt).scalars().all())
