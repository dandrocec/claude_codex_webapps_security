from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth import (
    create_access_token,
    get_current_user,
    get_optional_current_user,
    hash_password,
    new_csrf_token,
    set_auth_cookies,
    verify_password,
)
from app.config import Settings, get_settings
from app.database import Base, SessionLocal, engine, get_db
from app.models import Post, User, UserRole
from app.schemas import LoginRequest, PostCreate, PostRead, PostUpdate, TokenResponse, UserCreate, UserRead
from app.security import CSRFMiddleware, SecurityHeadersMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    settings = get_settings()
    if settings.admin_email and settings.admin_password:
        with SessionLocal() as db:
            existing_admin = db.scalar(select(User).where(User.email == settings.admin_email.lower()))
            if existing_admin is None:
                db.add(
                    User(
                        email=settings.admin_email.lower(),
                        password_hash=hash_password(settings.admin_password),
                        role=UserRole.admin,
                    )
                )
                db.commit()
    yield


app = FastAPI(
    title="Secure Blog REST API",
    version="1.0.0",
    description="JWT-authenticated blog API with author/admin role-based access control.",
    lifespan=lifespan,
)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CSRFMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={"detail": exc.errors()})


@app.exception_handler(SQLAlchemyError)
async def database_exception_handler(request: Request, exc: SQLAlchemyError) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Database error"})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content={"detail": "Internal server error"})


@app.get("/health", tags=["system"])
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/auth/csrf", tags=["auth"])
def csrf_token(response: Response, settings: Settings = Depends(get_settings)) -> dict[str, str]:
    token = new_csrf_token()
    response.set_cookie(
        "csrf_token",
        token,
        max_age=settings.access_token_expire_minutes * 60,
        httponly=False,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )
    return {"csrf_token": token}


@app.post("/auth/register", response_model=UserRead, status_code=status.HTTP_201_CREATED, tags=["auth"])
def register(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    user = User(email=payload.email.lower(), password_hash=hash_password(payload.password), role=UserRole.author)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered") from None
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=TokenResponse, tags=["auth"])
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> TokenResponse:
    user = db.scalar(select(User).where(User.email == payload.email.lower(), User.is_active.is_(True)))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    access_token = create_access_token(user, settings)
    csrf_token = new_csrf_token()
    set_auth_cookies(response, access_token, csrf_token, settings)
    return TokenResponse(access_token=access_token, csrf_token=csrf_token, user=user)


@app.post("/posts", response_model=PostRead, status_code=status.HTTP_201_CREATED, tags=["posts"])
def create_post(
    payload: PostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Post:
    post = Post(
        title=payload.title,
        content=payload.content,
        published=payload.published,
        author_id=current_user.id,
    )
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@app.get("/posts", response_model=list[PostRead], tags=["posts"])
def list_posts(
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
) -> list[Post]:
    query = select(Post).order_by(Post.created_at.desc())
    if current_user is None:
        query = query.where(Post.published.is_(True))
    elif current_user.role != UserRole.admin:
        query = query.where(or_(Post.published.is_(True), Post.author_id == current_user.id))
    return list(db.scalars(query).all())


@app.get("/me/posts", response_model=list[PostRead], tags=["posts"])
def list_my_posts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Post]:
    if current_user.role == UserRole.admin:
        return list(db.scalars(select(Post).order_by(Post.created_at.desc())).all())
    return list(db.scalars(select(Post).where(Post.author_id == current_user.id).order_by(Post.created_at.desc())).all())


def get_visible_post(post_id: int, db: Session, current_user: User | None = None) -> Post:
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if post.published:
        return post
    if current_user and (current_user.role == UserRole.admin or post.author_id == current_user.id):
        return post
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")


@app.get("/posts/{post_id}", response_model=PostRead, tags=["posts"])
def read_post(
    post_id: int,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_optional_current_user),
) -> Post:
    return get_visible_post(post_id, db, current_user)


def require_post_owner_or_admin(post_id: int, current_user: User, db: Session) -> Post:
    conditions = [Post.id == post_id]
    if current_user.role != UserRole.admin:
        conditions.append(Post.author_id == current_user.id)
    post = db.scalar(select(Post).where(*conditions))
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


@app.put("/posts/{post_id}", response_model=PostRead, tags=["posts"])
def update_post(
    post_id: int,
    payload: PostUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Post:
    post = require_post_owner_or_admin(post_id, current_user, db)
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(post, field, value)
    db.commit()
    db.refresh(post)
    return post


@app.delete("/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT, tags=["posts"])
def delete_post(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    post = require_post_owner_or_admin(post_id, current_user, db)
    db.delete(post)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
