"""Background worker that drains the DB-backed task queue.

Responsibilities:
  * fanout_post        -> materialize a post into every follower's timeline
  * fetch_link_preview -> extract URLs from a post and fetch OpenGraph previews

Run it as its own process::

    python -m app.worker

or let the API host it in a daemon thread (RUN_WORKER_INLINE=1, the default).
"""
import json
import logging
import re
import threading
import time

import httpx
from bs4 import BeautifulSoup

from .database import SessionLocal, init_db
from .models import Follow, LinkPreview, Post, Task

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s [worker] %(levelname)s %(message)s"
)
log = logging.getLogger("worker")

URL_RE = re.compile(r"https?://[^\s<>\"')]+")
MAX_ATTEMPTS = 3
POLL_INTERVAL = 1.0
HTTP_TIMEOUT = 8.0
USER_AGENT = "MicroblogPreviewBot/1.0 (+https://example.local)"


# --------------------------------------------------------------------------- #
# Task handlers
# --------------------------------------------------------------------------- #
def handle_fanout_post(db, payload):
    """Fan a post out onto the author's own timeline and all followers'."""
    post_id = payload["post_id"]
    post = db.get(Post, post_id)
    if post is None:
        return  # post was deleted; nothing to do

    recipient_ids = {post.author_id}
    follower_rows = (
        db.query(Follow.follower_id)
        .filter(Follow.followee_id == post.author_id)
        .all()
    )
    recipient_ids.update(row[0] for row in follower_rows)

    # Avoid duplicate feed entries if the task is retried.
    from .models import FeedItem

    existing = {
        row[0]
        for row in db.query(FeedItem.user_id)
        .filter(FeedItem.post_id == post_id)
        .all()
    }
    new_count = 0
    for uid in recipient_ids:
        if uid in existing:
            continue
        db.add(FeedItem(user_id=uid, post_id=post_id, created_at=post.created_at))
        new_count += 1
    db.commit()
    log.info("fanout post=%s -> %s new feed entries", post_id, new_count)


def _scrape_preview(url: str) -> dict:
    """Fetch a URL and pull out OpenGraph / <title> metadata."""
    headers = {"User-Agent": USER_AGENT}
    with httpx.Client(
        timeout=HTTP_TIMEOUT, follow_redirects=True, headers=headers
    ) as client:
        resp = client.get(url)
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "html" not in content_type:
            return {"title": url, "description": None, "image": None}
        soup = BeautifulSoup(resp.text, "html.parser")

    def og(prop):
        tag = soup.find("meta", property=prop) or soup.find(
            "meta", attrs={"name": prop}
        )
        return tag.get("content").strip() if tag and tag.get("content") else None

    title = og("og:title")
    if not title and soup.title and soup.title.string:
        title = soup.title.string.strip()
    description = og("og:description")
    if not description:
        desc_tag = soup.find("meta", attrs={"name": "description"})
        if desc_tag and desc_tag.get("content"):
            description = desc_tag["content"].strip()
    image = og("og:image")
    return {"title": title or url, "description": description, "image": image}


def handle_fetch_link_preview(db, payload):
    """Create + populate LinkPreview rows for every URL in a post."""
    post_id = payload["post_id"]
    post = db.get(Post, post_id)
    if post is None:
        return

    urls = []
    seen = set()
    for u in URL_RE.findall(post.content):
        u = u.rstrip(".,)")
        if u not in seen:
            seen.add(u)
            urls.append(u)

    for url in urls:
        preview = LinkPreview(post_id=post_id, url=url, status="pending")
        db.add(preview)
        db.flush()
        try:
            data = _scrape_preview(url)
            preview.title = (data.get("title") or "")[:512]
            preview.description = data.get("description")
            preview.image = data.get("image")
            preview.status = "ok"
            log.info("preview ok post=%s url=%s", post_id, url)
        except Exception as exc:  # noqa: BLE001 - record and continue
            preview.status = "error"
            preview.description = f"Could not fetch preview: {exc}"
            log.warning("preview error post=%s url=%s: %s", post_id, url, exc)
        db.commit()


HANDLERS = {
    "fanout_post": handle_fanout_post,
    "fetch_link_preview": handle_fetch_link_preview,
}


# --------------------------------------------------------------------------- #
# Queue loop
# --------------------------------------------------------------------------- #
def claim_task(db):
    """Atomically grab the oldest pending task and mark it running."""
    task = (
        db.query(Task)
        .filter(Task.status == "pending")
        .order_by(Task.id.asc())
        .first()
    )
    if task is None:
        return None
    task.status = "running"
    task.attempts += 1
    db.commit()
    return task


def process_one() -> bool:
    """Process a single task. Returns True if one was handled."""
    db = SessionLocal()
    try:
        task = claim_task(db)
        if task is None:
            return False
        handler = HANDLERS.get(task.type)
        try:
            if handler is None:
                raise ValueError(f"Unknown task type: {task.type}")
            handler(db, json.loads(task.payload or "{}"))
            task.status = "done"
            task.last_error = None
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            task = db.get(Task, task.id)
            task.last_error = str(exc)
            task.status = "pending" if task.attempts < MAX_ATTEMPTS else "failed"
            log.warning(
                "task %s (%s) failed attempt %s: %s",
                task.id,
                task.type,
                task.attempts,
                exc,
            )
        db.commit()
        return True
    finally:
        db.close()


def run(stop_event: threading.Event | None = None):
    """Poll the queue forever (or until stop_event is set)."""
    init_db()
    log.info("worker started")
    while stop_event is None or not stop_event.is_set():
        try:
            worked = process_one()
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            log.exception("unexpected worker error: %s", exc)
            worked = False
        if not worked:
            time.sleep(POLL_INTERVAL)


def start_in_thread() -> threading.Thread:
    """Start the worker in a daemon thread (used by the API process)."""
    thread = threading.Thread(target=run, name="microblog-worker", daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    run()
