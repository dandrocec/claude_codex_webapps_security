from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(32), unique=True, index=True, nullable=False)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    posts: Mapped[list["Post"]] = relationship(back_populates="author", cascade="all, delete-orphan")


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (
        UniqueConstraint("follower_id", "followed_id", name="uq_follow_pair"),
        Index("ix_follows_followed", "followed_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    followed_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class Post(Base):
    __tablename__ = "posts"
    __table_args__ = (Index("ix_posts_author_created", "author_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    body: Mapped[str] = mapped_column(String(280), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    author: Mapped[User] = relationship(back_populates="posts")
    previews: Mapped[list["LinkPreview"]] = relationship(back_populates="post", cascade="all, delete-orphan")


class LinkPreview(Base):
    __tablename__ = "link_previews"
    __table_args__ = (UniqueConstraint("post_id", "url", name="uq_preview_post_url"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    url: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    post: Mapped[Post] = relationship(back_populates="previews")


class FeedItem(Base):
    __tablename__ = "feed_items"
    __table_args__ = (
        UniqueConstraint("user_id", "post_id", name="uq_feed_user_post"),
        Index("ix_feed_user_created", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
