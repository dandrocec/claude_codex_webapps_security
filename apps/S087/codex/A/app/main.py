from fastapi import Depends, FastAPI, HTTPException, Path, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, hash_password, require_admin, verify_password
from app.database import Base, engine, get_db
from app.models import Organisation, Project, User, UserRole
from app.schemas import (
    OrganisationOut,
    OrganisationSignup,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    Token,
    UserCreate,
    UserOut,
)


Base.metadata.create_all(bind=engine)

app = FastAPI(title="Multi-Tenant SaaS Skeleton")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/orgs/signup", response_model=OrganisationOut, status_code=status.HTTP_201_CREATED)
def signup(payload: OrganisationSignup, db: Session = Depends(get_db)) -> Organisation:
    existing_org = db.scalar(select(Organisation).where(Organisation.slug == payload.org_slug))
    if existing_org:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Organisation slug already exists")

    organisation = Organisation(name=payload.org_name, slug=payload.org_slug)
    admin = User(
        organisation=organisation,
        email=payload.admin_email.lower(),
        hashed_password=hash_password(payload.admin_password),
        role=UserRole.admin,
    )
    db.add_all([organisation, admin])
    db.commit()
    db.refresh(organisation)
    return organisation


@app.post("/orgs/{org_slug}/login", response_model=Token)
def login(
    org_slug: str = Path(pattern=r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$"),
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
) -> Token:
    organisation = db.scalar(select(Organisation).where(Organisation.slug == org_slug))
    if organisation is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid organisation or credentials")

    user = db.scalar(
        select(User).where(
            User.organisation_id == organisation.id,
            User.email == form.username.lower(),
        )
    )
    if user is None or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid organisation or credentials")

    return Token(access_token=create_access_token(user))


@app.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@app.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> User:
    existing_user = db.scalar(
        select(User).where(
            User.organisation_id == current_admin.organisation_id,
            User.email == payload.email.lower(),
        )
    )
    if existing_user:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="User already exists in this organisation")

    user = User(
        organisation_id=current_admin.organisation_id,
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.get("/users", response_model=list[UserOut])
def list_users(
    current_admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[User]:
    return list(db.scalars(select(User).where(User.organisation_id == current_admin.organisation_id)))


@app.post("/projects", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    payload: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    project = Project(
        organisation_id=current_user.organisation_id,
        owner_id=current_user.id,
        name=payload.name,
        description=payload.description,
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@app.get("/projects", response_model=list[ProjectOut])
def list_projects(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Project]:
    return list(db.scalars(select(Project).where(Project.organisation_id == current_user.organisation_id)))


@app.get("/projects/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organisation_id == current_user.organisation_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@app.patch("/projects/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Project:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organisation_id == current_user.organisation_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)
    return project


@app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    project = db.scalar(
        select(Project).where(
            Project.id == project_id,
            Project.organisation_id == current_user.organisation_id,
        )
    )
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    db.delete(project)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
