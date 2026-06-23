"""Post CRUD endpoints with role- and ownership-based access control."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..deps import csrf_protect, get_current_user

router = APIRouter(prefix="/posts", tags=["posts"])


def _can_modify(user: models.User, post: models.Post) -> bool:
    """Admins may modify any post; authors only their own (IDOR prevention)."""
    return user.role == models.Role.admin or post.author_id == user.id


def _get_owned_or_admin(
    post_id: int, user: models.User, db: Session
) -> models.Post:
    post = crud.get_post(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    if not _can_modify(user, post):
        # 404 (not 403) so we don't reveal existence of others' resources.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


# ----- Public read -----

@router.get("", response_model=list[schemas.PostOut])
def list_published(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[models.Post]:
    return crud.list_published_posts(db, skip=skip, limit=limit)


@router.get("/mine", response_model=list[schemas.PostOut])
def list_mine(
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
) -> list[models.Post]:
    return crud.list_posts_for_author(db, author_id=user.id, skip=skip, limit=limit)


@router.get("/{post_id}", response_model=schemas.PostOut)
def get_one(
    post_id: int,
    db: Session = Depends(get_db),
) -> models.Post:
    post = crud.get_post(db, post_id)
    if post is None or not post.published:
        # Unpublished posts are only reachable via the owner/admin routes below.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


# ----- Authenticated write (CSRF-protected) -----

@router.post(
    "",
    response_model=schemas.PostOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(csrf_protect)],
)
def create(
    data: schemas.PostCreate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.Post:
    return crud.create_post(db, data, author_id=user.id)


@router.put(
    "/{post_id}",
    response_model=schemas.PostOut,
    dependencies=[Depends(csrf_protect)],
)
def update(
    post_id: int,
    data: schemas.PostUpdate,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.Post:
    post = _get_owned_or_admin(post_id, user, db)
    return crud.update_post(db, post, data)


@router.delete(
    "/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(csrf_protect)],
)
def delete(
    post_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    post = _get_owned_or_admin(post_id, user, db)
    crud.delete_post(db, post)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
