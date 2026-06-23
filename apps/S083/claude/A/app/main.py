from contextlib import asynccontextmanager

from fastapi import FastAPI

from .config import settings
from .database import Base, SessionLocal, engine
from .models import Post, Role, User
from .routers import auth, posts
from .security import hash_password


def seed_demo_data() -> None:
    """Create demo author/admin accounts and a couple of posts on first run."""
    db = SessionLocal()
    try:
        if db.query(User).first() is not None:
            return  # Already seeded.

        admin = User(username="admin", hashed_password=hash_password("admin123"), role=Role.admin)
        author = User(
            username="author", hashed_password=hash_password("author123"), role=Role.author
        )
        db.add_all([admin, author])
        db.flush()  # assign IDs

        db.add_all(
            [
                Post(
                    title="Welcome to the blog",
                    content="This published post is visible to everyone.",
                    published=True,
                    author_id=author.id,
                ),
                Post(
                    title="My draft",
                    content="This unpublished draft is only visible to its author and admins.",
                    published=False,
                    author_id=author.id,
                ),
            ]
        )
        db.commit()
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    if settings.seed_demo_data:
        seed_demo_data()
    yield


app = FastAPI(
    title="Blog API",
    description="A FastAPI blog with JWT auth and author/admin roles.",
    version="1.0.0",
    lifespan=lifespan,
)

app.include_router(auth.router)
app.include_router(posts.router)


@app.get("/", tags=["meta"])
def root() -> dict:
    return {
        "name": "Blog API",
        "docs": "/docs",
        "openapi_schema": "/openapi.json",
    }
