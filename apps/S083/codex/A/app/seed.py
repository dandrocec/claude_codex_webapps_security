from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.models import User, UserRole


def seed_users(db: Session) -> None:
    defaults = [
        {"username": "author", "password": "authorpass", "role": UserRole.author},
        {"username": "admin", "password": "adminpass", "role": UserRole.admin},
    ]

    for item in defaults:
        existing = db.scalar(select(User).where(User.username == item["username"]))
        if existing:
            continue
        db.add(
            User(
                username=item["username"],
                hashed_password=hash_password(item["password"]),
                role=item["role"],
            )
        )
    db.commit()
