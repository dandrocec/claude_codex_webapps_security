from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware

from app.config import get_settings
from app.database import Base, engine, get_db
from app.models import Organisation, Project, User, UserRole
from app.schemas import (
    CsrfResponse,
    LoginRequest,
    ProjectCreateRequest,
    ProjectResponse,
    ProjectUpdateRequest,
    SessionResponse,
    SignupRequest,
    SignupResponse,
    UserCreateRequest,
    UserResponse,
)
from app.security import encode_output, enforce_csrf, hash_password, issue_csrf_token, require_admin, require_user, verify_password


settings = get_settings()
app = FastAPI(
    title="Multi-Tenant SaaS Skeleton",
    version="1.0.0",
    dependencies=[Depends(enforce_csrf)],
    docs_url="/docs",
    redoc_url=None,
)

app.add_middleware(
    SessionMiddleware,
    secret_key=settings.app_secret_key,
    session_cookie=settings.session_cookie_name,
    max_age=settings.session_max_age_seconds,
    same_site="strict",
    https_only=settings.secure_cookie,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"detail": "Invalid request"})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.on_event("startup")
def startup() -> None:
    Base.metadata.create_all(bind=engine)


def org_response(org: Organisation) -> dict:
    return {"id": org.id, "name": encode_output(org.name), "slug": encode_output(org.slug)}


def user_response(user: User) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/csrf-token", response_model=CsrfResponse)
def csrf_token(request: Request) -> CsrfResponse:
    return CsrfResponse(csrf_token=issue_csrf_token(request))


@app.post("/orgs/signup", response_model=SignupResponse, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, request: Request, db: Annotated[Session, Depends(get_db)]) -> SignupResponse:
    org = Organisation(name=payload.org_name, slug=payload.org_slug)
    user = User(email=str(payload.admin_email).lower(), password_hash=hash_password(payload.admin_password), role=UserRole.ADMIN)
    org.users.append(user)
    db.add(org)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Organisation or user already exists")
    db.refresh(org)
    db.refresh(user)
    request.session["organisation_id"] = org.id
    request.session["user_id"] = user.id
    csrf_token = issue_csrf_token(request)
    return SignupResponse(organisation=org_response(org), admin_user=user_response(user), csrf_token=csrf_token)


@app.post("/auth/login", response_model=SessionResponse)
def login(payload: LoginRequest, request: Request, db: Annotated[Session, Depends(get_db)]) -> SessionResponse:
    stmt = (
        select(User, Organisation)
        .join(Organisation, User.organisation_id == Organisation.id)
        .where(Organisation.slug == payload.org_slug, User.email == str(payload.email).lower(), User.is_active.is_(True))
    )
    row = db.execute(stmt).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid organisation, email, or password")
    user, org = row
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid organisation, email, or password")

    request.session.clear()
    request.session["organisation_id"] = org.id
    request.session["user_id"] = user.id
    csrf_token = issue_csrf_token(request)
    return SessionResponse(authenticated=True, organisation=org_response(org), user=user_response(user), csrf_token=csrf_token)


@app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request) -> Response:
    request.session.clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/me", response_model=SessionResponse)
def me(user: Annotated[User, Depends(require_user)]) -> SessionResponse:
    return SessionResponse(authenticated=True, organisation=org_response(user.organisation), user=user_response(user))


@app.post("/admin/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    admin: Annotated[User, Depends(require_admin)],
    db: Annotated[Session, Depends(get_db)],
) -> UserResponse:
    user = User(
        organisation_id=admin.organisation_id,
        email=str(payload.email).lower(),
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="User already exists")
    db.refresh(user)
    return UserResponse(**user_response(user))


@app.get("/projects", response_model=list[ProjectResponse])
def list_projects(user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> list[ProjectResponse]:
    projects = db.scalars(select(Project).where(Project.organisation_id == user.organisation_id).order_by(Project.created_at.desc())).all()
    return [ProjectResponse.from_project(project) for project in projects]


@app.post("/projects", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreateRequest,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectResponse:
    project = Project(
        organisation_id=user.organisation_id,
        owner_user_id=user.id,
        name=payload.name,
        description=payload.description,
    )
    db.add(project)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Project already exists")
    db.refresh(project)
    return ProjectResponse.from_project(project)


def get_project_for_user(project_id: int, user: User, db: Session) -> Project:
    project = db.scalar(select(Project).where(Project.id == project_id, Project.organisation_id == user.organisation_id))
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@app.get("/projects/{project_id}", response_model=ProjectResponse)
def get_project(project_id: int, user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> ProjectResponse:
    return ProjectResponse.from_project(get_project_for_user(project_id, user, db))


@app.patch("/projects/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    payload: ProjectUpdateRequest,
    user: Annotated[User, Depends(require_user)],
    db: Annotated[Session, Depends(get_db)],
) -> ProjectResponse:
    project = get_project_for_user(project_id, user, db)
    if payload.name is not None:
        project.name = payload.name
    if payload.description is not None:
        project.description = payload.description
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Project already exists")
    db.refresh(project)
    return ProjectResponse.from_project(project)


@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(project_id: int, user: Annotated[User, Depends(require_user)], db: Annotated[Session, Depends(get_db)]) -> Response:
    project = get_project_for_user(project_id, user, db)
    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
