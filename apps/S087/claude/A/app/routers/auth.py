from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Organisation, Role, User
from ..schemas import LoginRequest, SignupRequest, Token, UserOut
from ..security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
def signup(payload: SignupRequest, db: Session = Depends(get_db)):
    """Register a new organisation and its first user (an admin)."""
    exists = db.scalar(select(Organisation).where(Organisation.slug == payload.org_slug))
    if exists:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Organisation slug already taken")

    org = Organisation(name=payload.org_name, slug=payload.org_slug)
    db.add(org)
    db.flush()  # assign org.id without committing yet

    admin = User(
        org_id=org.id,
        email=payload.admin_email,
        hashed_password=hash_password(payload.admin_password),
        role=Role.admin,
    )
    db.add(admin)
    db.commit()
    db.refresh(admin)

    return Token(access_token=create_access_token(user_id=admin.id, org_id=admin.org_id))


@router.post("/login", response_model=Token)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    """Org-scoped login: the same email may exist in different organisations."""
    org = db.scalar(select(Organisation).where(Organisation.slug == payload.org_slug))
    user = None
    if org is not None:
        user = db.scalar(
            select(User).where(User.org_id == org.id, User.email == payload.email)
        )

    # Verify password even when user is missing-ish to keep responses uniform.
    if user is None or not user.is_active or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid organisation, email or password",
        )

    return Token(access_token=create_access_token(user_id=user.id, org_id=user.org_id))


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
