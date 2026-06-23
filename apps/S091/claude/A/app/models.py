"""SQLAlchemy ORM models.

The schema covers the social graph (users + follows), content (posts +
link previews), the materialized per-user timeline (feed_items) and the
durable task queue (tasks).
"""
import datetime as dt

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(50), unique=True, nullable=False, index=True)
    created_at = Column(DateTime, default=utcnow)

    posts = relationship(
        "Post", back_populates="author", cascade="all, delete-orphan"
    )


class Follow(Base):
    __tablename__ = "follows"

    id = Column(Integer, primary_key=True)
    follower_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    followee_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("follower_id", "followee_id", name="uq_follow"),
    )


class Post(Base):
    __tablename__ = "posts"

    id = Column(Integer, primary_key=True)
    author_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=utcnow, index=True)

    author = relationship("User", back_populates="posts")
    previews = relationship(
        "LinkPreview", back_populates="post", cascade="all, delete-orphan"
    )


class FeedItem(Base):
    """A post fanned out into one user's timeline (fan-out-on-write)."""

    __tablename__ = "feed_items"

    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    post_id = Column(
        Integer, ForeignKey("posts.id", ondelete="CASCADE"), nullable=False
    )
    created_at = Column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_feed"),
        Index("ix_feed_user_created", "user_id", "created_at"),
    )


class LinkPreview(Base):
    __tablename__ = "link_previews"

    id = Column(Integer, primary_key=True)
    post_id = Column(
        Integer,
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url = Column(String(2048), nullable=False)
    title = Column(String(512))
    description = Column(Text)
    image = Column(String(2048))
    status = Column(String(20), default="pending")  # pending | ok | error
    created_at = Column(DateTime, default=utcnow)


class Task(Base):
    """A durable unit of background work polled by the worker."""

    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    type = Column(String(50), nullable=False)
    payload = Column(Text, nullable=False, default="{}")
    status = Column(
        String(20), default="pending", index=True
    )  # pending | running | done | failed
    attempts = Column(Integer, default=0, nullable=False)
    last_error = Column(Text)
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)
