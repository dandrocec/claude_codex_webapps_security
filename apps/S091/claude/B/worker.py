"""Standalone background worker.

Use this if you set WORKER_ENABLED=false and want to run the worker as its own
process (recommended for production):

    python worker.py
"""
import logging

from app.database import init_db
from app.tasks import run_worker

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    init_db()
    run_worker()
