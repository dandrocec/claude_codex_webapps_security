import re
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from sqlalchemy import delete, select
from sqlalchemy.orm import joinedload

from app.database import SessionLocal, init_db
from app.models import FeedItem, Follow, LinkPreview, Post, User


URL_RE = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)


def extract_urls(body: str) -> list[str]:
    urls = []
    for raw in URL_RE.findall(body):
        cleaned = raw.rstrip(".,!?;:)")
        if cleaned not in urls:
            urls.append(cleaned)
    return urls


def rebuild_user_feed(user_id: int) -> int:
    init_db()
    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if user is None:
            return 0

        followee_ids = list(
            db.scalars(select(Follow.followee_id).where(Follow.follower_id == user_id))
        )
        author_ids = [user_id, *followee_ids]
        posts = list(
            db.scalars(
                select(Post)
                .where(Post.user_id.in_(author_ids))
                .order_by(Post.created_at.desc())
                .limit(200)
            )
        )

        db.execute(delete(FeedItem).where(FeedItem.user_id == user_id))
        for post in posts:
            db.add(FeedItem(user_id=user_id, post_id=post.id, created_at=post.created_at))
        db.commit()
        return len(posts)
    finally:
        db.close()


def rebuild_author_audience(author_id: int) -> int:
    init_db()
    db = SessionLocal()
    try:
        recipient_ids = [author_id, *db.scalars(select(Follow.follower_id).where(Follow.followee_id == author_id))]
    finally:
        db.close()

    for user_id in recipient_ids:
        rebuild_user_feed(user_id)
    return len(recipient_ids)


def fetch_link_previews(post_id: int) -> int:
    init_db()
    db = SessionLocal()
    try:
        post = (
            db.execute(select(Post).options(joinedload(Post.previews)).where(Post.id == post_id))
            .unique()
            .scalar_one_or_none()
        )
        if post is None:
            return 0

        existing = {preview.url for preview in post.previews}
        created = 0
        for url in extract_urls(post.body):
            if url in existing:
                continue
            preview = fetch_one_preview(url)
            db.add(LinkPreview(post_id=post_id, **preview))
            created += 1

        db.commit()
        return created
    finally:
        db.close()


def fetch_one_preview(url: str) -> dict[str, str | datetime]:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return {"url": url, "status": "invalid", "fetched_at": datetime.utcnow()}

    try:
        response = requests.get(
            url,
            timeout=5,
            headers={"User-Agent": "FastAPI Microblog Link Preview Bot/1.0"},
        )
        response.raise_for_status()
        soup = BeautifulSoup(response.text[:300_000], "html.parser")
        title = meta_content(soup, "og:title") or text_or_empty(soup.title)
        description = meta_content(soup, "og:description") or meta_name_content(soup, "description")
        image_url = meta_content(soup, "og:image")
        return {
            "url": url,
            "title": title[:240],
            "description": description[:500],
            "image_url": image_url[:1000],
            "status": "ok",
            "fetched_at": datetime.utcnow(),
        }
    except Exception as exc:
        return {
            "url": url,
            "title": "",
            "description": str(exc)[:500],
            "image_url": "",
            "status": "error",
            "fetched_at": datetime.utcnow(),
        }


def meta_content(soup: BeautifulSoup, property_name: str) -> str:
    tag = soup.find("meta", property=property_name)
    value = tag.get("content", "") if tag else ""
    return value.strip()


def meta_name_content(soup: BeautifulSoup, name: str) -> str:
    tag = soup.find("meta", attrs={"name": name})
    value = tag.get("content", "") if tag else ""
    return value.strip()


def text_or_empty(node: object) -> str:
    if node is None:
        return ""
    return getattr(node, "text", "").strip()
