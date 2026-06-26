import asyncio

from redis import Redis
from rq import Queue
from sqlalchemy import delete, insert, select
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.db import SessionLocal
from app.models import FeedItem, Follow, LinkPreview, Post
from app.security import extract_urls
from app.ssrf import fetch_preview


def get_queue() -> Queue:
    settings = get_settings()
    return Queue("microblog", connection=Redis.from_url(settings.redis_url))


def enqueue_job(func_name: str, *args: object) -> None:
    queue = get_queue()
    queue.enqueue(f"app.tasks.{func_name}", *args, job_timeout=30)


def refresh_feed_for_user(user_id: int) -> None:
    with SessionLocal() as db:
        followed_ids = [row[0] for row in db.execute(select(Follow.followed_id).where(Follow.follower_id == user_id)).all()]
        source_ids = followed_ids + [user_id]
        db.execute(delete(FeedItem).where(FeedItem.user_id == user_id))
        posts = db.execute(
            select(Post.id, Post.created_at)
            .where(Post.author_id.in_(source_ids))
            .order_by(Post.created_at.desc())
            .limit(200)
        ).all()
        if posts:
            db.execute(insert(FeedItem), [{"user_id": user_id, "post_id": post_id, "created_at": created_at} for post_id, created_at in posts])
        db.commit()


def refresh_feeds_for_author(author_id: int) -> None:
    with SessionLocal() as db:
        follower_ids = [row[0] for row in db.execute(select(Follow.follower_id).where(Follow.followed_id == author_id)).all()]
    for user_id in set(follower_ids + [author_id]):
        refresh_feed_for_user(user_id)


async def _fetch_previews_async(post_id: int) -> None:
    with SessionLocal() as db:
        post = db.scalar(select(Post).options(selectinload(Post.previews)).where(Post.id == post_id))
        if post is None:
            return
        urls = extract_urls(post.body)
    for url in urls:
        status = "ready"
        try:
            preview = await fetch_preview(url)
        except Exception:
            preview = {"url": url, "title": url, "description": ""}
            status = "blocked"
        with SessionLocal() as db:
            existing = db.scalar(select(LinkPreview).where(LinkPreview.post_id == post_id, LinkPreview.url == url))
            if existing:
                existing.title = preview["title"]
                existing.description = preview["description"]
                existing.status = status
            else:
                db.add(LinkPreview(post_id=post_id, url=url, title=preview["title"], description=preview["description"], status=status))
            db.commit()


def fetch_link_previews(post_id: int) -> None:
    asyncio.run(_fetch_previews_async(post_id))
