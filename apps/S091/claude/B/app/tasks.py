"""Database-backed task queue, handlers and the background worker loop.

Tasks are persisted in the `tasks` table so they survive restarts. A worker
(either the in-process thread started by the app, or `python worker.py`) polls
for pending tasks and runs them. SQLite is configured with WAL + busy_timeout so
the worker and web app can share the database safely.
"""
from __future__ import annotations

import json
import logging
import threading
import time

from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from .config import settings
from .database import SessionLocal
from .models import FeedEntry, Follow, LinkPreview, Post, Task
from .ssrf import SSRFError, fetch_link_preview

logger = logging.getLogger("microblog.worker")

MAX_ATTEMPTS = 3
_BACKFILL_LIMIT = 50


def enqueue(db: OrmSession, task_type: str, payload: dict) -> None:
    db.add(Task(type=task_type, payload=json.dumps(payload), status="pending"))
    db.commit()


# --------------------------------------------------------------------------- #
# Task handlers
# --------------------------------------------------------------------------- #
def _handle_fanout(db: OrmSession, payload: dict) -> None:
    """Write a feed entry for the author and each of their followers."""
    post = db.get(Post, payload["post_id"])
    if post is None:
        return

    recipient_ids = {post.author_id}
    follower_ids = db.execute(
        select(Follow.follower_id).where(Follow.followee_id == post.author_id)
    ).scalars().all()
    recipient_ids.update(follower_ids)

    for uid in recipient_ids:
        exists = db.execute(
            select(FeedEntry.id).where(
                FeedEntry.user_id == uid, FeedEntry.post_id == post.id
            )
        ).first()
        if not exists:
            db.add(FeedEntry(user_id=uid, post_id=post.id, created_at=post.created_at))
    db.commit()


def _handle_backfill(db: OrmSession, payload: dict) -> None:
    """When A follows B, copy B's recent posts into A's feed."""
    follower_id = payload["follower_id"]
    followee_id = payload["followee_id"]
    posts = db.execute(
        select(Post)
        .where(Post.author_id == followee_id)
        .order_by(Post.created_at.desc())
        .limit(_BACKFILL_LIMIT)
    ).scalars().all()
    for post in posts:
        exists = db.execute(
            select(FeedEntry.id).where(
                FeedEntry.user_id == follower_id, FeedEntry.post_id == post.id
            )
        ).first()
        if not exists:
            db.add(
                FeedEntry(user_id=follower_id, post_id=post.id, created_at=post.created_at)
            )
    db.commit()


def _handle_link_preview(db: OrmSession, payload: dict) -> None:
    preview_id = payload["preview_id"]
    preview = db.get(LinkPreview, preview_id)
    if preview is None:
        return
    from .models import utcnow

    try:
        result = fetch_link_preview(preview.url)
        preview.title = result.title
        preview.description = result.description
        preview.image_url = result.image_url
        preview.status = "ok"
        preview.error = None
    except SSRFError as exc:
        preview.status = "blocked"
        preview.error = str(exc)[:255]
    except Exception:  # noqa: BLE001 - never leak internals; record generic failure
        logger.exception("link preview failed for preview_id=%s", preview_id)
        preview.status = "error"
        preview.error = "fetch failed"
    finally:
        preview.fetched_at = utcnow()
        db.commit()


_HANDLERS = {
    "fanout": _handle_fanout,
    "backfill": _handle_backfill,
    "link_preview": _handle_link_preview,
}


# --------------------------------------------------------------------------- #
# Worker loop
# --------------------------------------------------------------------------- #
def _claim_next_task(db: OrmSession) -> Task | None:
    task = db.execute(
        select(Task).where(Task.status == "pending").order_by(Task.id).limit(1)
    ).scalar_one_or_none()
    if task is None:
        return None
    task.status = "processing"
    db.commit()
    return task


def process_once(db: OrmSession) -> bool:
    task = _claim_next_task(db)
    if task is None:
        return False

    handler = _HANDLERS.get(task.type)
    try:
        if handler is None:
            raise ValueError(f"unknown task type {task.type}")
        handler(db, json.loads(task.payload))
        task.status = "done"
        task.last_error = None
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        task.attempts += 1
        task.last_error = str(exc)[:500]
        task.status = "failed" if task.attempts >= MAX_ATTEMPTS else "pending"
        logger.warning("task %s (%s) failed: %s", task.id, task.type, exc)
    db.commit()
    return True


def run_worker(stop_event: threading.Event | None = None) -> None:
    logger.info("worker started")
    while stop_event is None or not stop_event.is_set():
        db = SessionLocal()
        try:
            did_work = process_once(db)
        except Exception:  # noqa: BLE001
            logger.exception("worker loop error")
            did_work = False
        finally:
            db.close()
        if not did_work:
            time.sleep(settings.WORKER_POLL_SECONDS)


def start_worker_thread() -> tuple[threading.Thread, threading.Event]:
    stop_event = threading.Event()
    thread = threading.Thread(
        target=run_worker, args=(stop_event,), name="microblog-worker", daemon=True
    )
    thread.start()
    return thread, stop_event
