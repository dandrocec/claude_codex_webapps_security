"""Optional first-run seeding of an admin account (local dev convenience)."""
from __future__ import annotations

import logging

from . import crud, models, schemas
from .config import settings
from .database import SessionLocal

logger = logging.getLogger("blog.seed")


def seed_admin() -> None:
    if not settings.seed_admin_password:
        return  # nothing to seed unless an explicit password is configured
    db = SessionLocal()
    try:
        if crud.get_user_by_username(db, settings.seed_admin_username):
            return
        crud.create_user(
            db,
            schemas.UserCreate(
                username=settings.seed_admin_username,
                password=settings.seed_admin_password,
                role=models.Role.admin,
            ),
        )
        logger.info("Seeded admin user %r", settings.seed_admin_username)
    finally:
        db.close()
