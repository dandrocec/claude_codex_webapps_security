from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user, require_admin
from ..models import Role, User
from ..schemas import UserCreate, UserOut, UserRoleUpdate
from ..security import hash_password

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserOut])
def list_users(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List users in the caller's organisation only."""
    return db.scalars(select(User).where(User.org_id == current_user.org_id)).all()


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin creates a new user inside their own organisation."""
    clash = db.scalar(
        select(User).where(User.org_id == admin.org_id, User.email == payload.email)
    )
    if clash:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already in use in this organisation")

    user = User(
        org_id=admin.org_id,
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _get_org_user(user_id: int, org_id: int, db: Session) -> User:
    user = db.get(User, user_id)
    if user is None or user.org_id != org_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


@router.patch("/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: int,
    payload: UserRoleUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = _get_org_user(user_id, admin.org_id, db)

    # Prevent an org from losing its last admin.
    if user.id == admin.id and payload.role != Role.admin:
        remaining_admins = db.scalar(
            select(User).where(
                User.org_id == admin.org_id, User.role == Role.admin, User.id != admin.id
            )
        )
        if remaining_admins is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot demote the last admin of the organisation",
            )

    user.role = payload.role
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    user = _get_org_user(user_id, admin.org_id, db)
    if user.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Admins cannot delete themselves")
    db.delete(user)
    db.commit()
