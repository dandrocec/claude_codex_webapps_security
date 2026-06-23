"""Small helper for enqueuing background tasks onto the DB-backed queue."""
import json
from typing import Optional

from sqlalchemy.orm import Session

from .models import Task


def enqueue(db: Session, task_type: str, payload: Optional[dict] = None) -> Task:
    """Insert a pending task. Caller is responsible for committing."""
    task = Task(type=task_type, payload=json.dumps(payload or {}))
    db.add(task)
    db.flush()
    return task
