import os
from typing import Any

from redis import Redis
from rq import Queue


REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
QUEUE_NAME = "microblog"


def redis_connection() -> Redis:
    return Redis.from_url(REDIS_URL)


def queue() -> Queue:
    return Queue(QUEUE_NAME, connection=redis_connection())


def enqueue(task: str, *args: Any, **kwargs: Any) -> str:
    job = queue().enqueue(task, *args, **kwargs)
    return job.id
