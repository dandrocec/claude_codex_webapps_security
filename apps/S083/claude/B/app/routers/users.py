"""User registration and admin user management."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..deps import csrf_protect, require_admin

router = APIRouter(prefix="/users", tags=["users"])


@router.post(
    "/register",
    response_model=schemas.UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
)
def register(data: schemas.UserCreate, db: Session = Depends(get_db)) -> models.User:
    # Public self-registration is always an author; admins are provisioned
    # separately. This prevents privilege escalation via the request body.
    if crud.get_user_by_username(db, data.username) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already taken"
        )
    data.role = models.Role.author
    return crud.create_user(db, data)


@router.post(
    "",
    response_model=schemas.UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
)
def admin_create_user(
    data: schemas.UserCreate,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_admin),
) -> models.User:
    # Admin-only: may create users with any role.
    if crud.get_user_by_username(db, data.username) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Username already taken"
        )
    return crud.create_user(db, data)
