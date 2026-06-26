from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    posts: Mapped[list["Post"]] = relationship(back_populates="author", cascade="all, delete-orphan")


class Follow(Base):
    __tablename__ = "follows"
    __table_args__ = (UniqueConstraint("follower_id", "followee_id", name="uq_follow"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    follower_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    followee_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    author: Mapped[User] = relationship(back_populates="posts")
    previews: Mapped[list["LinkPreview"]] = relationship(back_populates="post", cascade="all, delete-orphan")


class LinkPreview(Base):
    __tablename__ = "link_previews"
    __table_args__ = (UniqueConstraint("post_id", "url", name="uq_post_url_preview"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(String(240), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    image_url: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(30), default="pending")
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    post: Mapped[Post] = relationship(back_populates="previews")


class FeedItem(Base):
    __tablename__ = "feed_items"
    __table_args__ = (UniqueConstraint("user_id", "post_id", name="uq_feed_post"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("posts.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    post: Mapped[Post] = relationship()
