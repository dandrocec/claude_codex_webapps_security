from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.auth import (
    authenticate_user,
    create_access_token,
    get_optional_current_user,
    require_writer,
)
from app.database import Base, SessionLocal, engine, get_db
from app.models import Post, User, UserRole
from app.schemas import LoginRequest, PostCreate, PostRead, PostUpdate, Token
from app.seed import seed_users


app = FastAPI(
    title="Blog REST API",
    version="1.0.0",
    description="JWT-authenticated blog API with author and admin roles.",
)


@app.on_event("startup")
def on_startup() -> None:
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_users(db)


@app.post("/auth/login", response_model=Token, tags=["auth"])
def login(payload: LoginRequest, db: Annotated[Session, Depends(get_db)]) -> Token:
    user = authenticate_user(db, payload.username, payload.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Token(access_token=create_access_token(user))


@app.get("/posts", response_model=list[PostRead], tags=["posts"])
def list_posts(
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User | None, Depends(get_optional_current_user)],
    published: Annotated[bool | None, Query(description="Filter by publication state")] = None,
) -> list[Post]:
    query = select(Post).options(selectinload(Post.author)).order_by(Post.created_at.desc())

    if current_user is None:
        query = query.where(Post.published.is_(True))
    elif current_user.role == UserRole.author:
        query = query.where(or_(Post.published.is_(True), Post.author_id == current_user.id))

    if published is not None:
        query = query.where(Post.published.is_(published))

    return list(db.scalars(query).all())


@app.post("/posts", response_model=PostRead, status_code=status.HTTP_201_CREATED, tags=["posts"])
def create_post(
    payload: PostCreate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_writer)],
) -> Post:
    post = Post(**payload.model_dump(), author_id=current_user.id)
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@app.get("/posts/{post_id}", response_model=PostRead, tags=["posts"])
def get_post(
    post_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User | None, Depends(get_optional_current_user)],
) -> Post:
    post = db.scalar(select(Post).options(selectinload(Post.author)).where(Post.id == post_id))
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if can_read_post(post, current_user):
        return post
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")


@app.put("/posts/{post_id}", response_model=PostRead, tags=["posts"])
def update_post(
    post_id: int,
    payload: PostUpdate,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_writer)],
) -> Post:
    post = get_existing_post_for_write(db, post_id, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(post, field, value)
    db.commit()
    db.refresh(post)
    return post


@app.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["posts"])
def delete_post(
    post_id: int,
    db: Annotated[Session, Depends(get_db)],
    current_user: Annotated[User, Depends(require_writer)],
) -> Response:
    post = get_existing_post_for_write(db, post_id, current_user)
    db.delete(post)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def get_existing_post_for_write(db: Session, post_id: int, current_user: User) -> Post:
    post = db.scalar(select(Post).options(selectinload(Post.author)).where(Post.id == post_id))
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if current_user.role == UserRole.admin or post.author_id == current_user.id:
        return post
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot manage this post")


def can_read_post(post: Post, current_user: User | None) -> bool:
    if post.published:
        return True
    if current_user is None:
        return False
    return current_user.role == UserRole.admin or post.author_id == current_user.id
