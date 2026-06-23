"""Data-access helpers. All queries go through the ORM (parameterised SQL)."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import models, schemas
from .security import hash_password


# ----- Users -----

def get_user_by_username(db: Session, username: str) -> models.User | None:
    return db.scalar(select(models.User).where(models.User.username == username))


def get_user(db: Session, user_id: int) -> models.User | None:
    return db.get(models.User, user_id)


def create_user(db: Session, data: schemas.UserCreate) -> models.User:
    user = models.User(
        username=data.username,
        password_hash=hash_password(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


# ----- Posts -----

def get_post(db: Session, post_id: int) -> models.Post | None:
    return db.get(models.Post, post_id)


def list_published_posts(db: Session, skip: int = 0, limit: int = 50) -> list[models.Post]:
    stmt = (
        select(models.Post)
        .where(models.Post.published.is_(True))
        .order_by(models.Post.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt))


def list_posts_for_author(
    db: Session, author_id: int, skip: int = 0, limit: int = 50
) -> list[models.Post]:
    stmt = (
        select(models.Post)
        .where(models.Post.author_id == author_id)
        .order_by(models.Post.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    return list(db.scalars(stmt))


def create_post(db: Session, data: schemas.PostCreate, author_id: int) -> models.Post:
    post = models.Post(
        title=data.title,
        content=data.content,
        published=data.published,
        author_id=author_id,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


def update_post(db: Session, post: models.Post, data: schemas.PostUpdate) -> models.Post:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(post, field, value)
    db.commit()
    db.refresh(post)
    return post


def delete_post(db: Session, post: models.Post) -> None:
    db.delete(post)
    db.commit()
