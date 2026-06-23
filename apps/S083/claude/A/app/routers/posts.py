from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import get_current_user
from ..models import Post, Role, User
from ..schemas import PostCreate, PostOut, PostUpdate

router = APIRouter(prefix="/posts", tags=["posts"])


def _get_post_or_404(post_id: int, db: Session) -> Post:
    post = db.get(Post, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


def _can_manage(user: User, post: Post) -> bool:
    """Admins manage any post; authors manage only their own."""
    return user.role == Role.admin or post.author_id == user.id


@router.get("", response_model=list[PostOut])
def list_published_posts(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[Post]:
    """Public: list published posts. No authentication required."""
    return (
        db.query(Post)
        .filter(Post.published.is_(True))
        .order_by(Post.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/mine", response_model=list[PostOut])
def list_my_posts(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> list[Post]:
    """List all of the current user's posts, including unpublished drafts."""
    return (
        db.query(Post)
        .filter(Post.author_id == current_user.id)
        .order_by(Post.created_at.desc())
        .all()
    )


@router.get("/{post_id}", response_model=PostOut)
def get_post(post_id: int, db: Session = Depends(get_db)) -> Post:
    """Read a single post. Unpublished posts return 404 to anonymous callers."""
    post = _get_post_or_404(post_id, db)
    if not post.published:
        # Hide drafts from the public; owners/admins should use the authenticated routes.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Post not found")
    return post


@router.post("", response_model=PostOut, status_code=status.HTTP_201_CREATED)
def create_post(
    payload: PostCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Post:
    """Create a post owned by the current user (authors and admins)."""
    post = Post(**payload.model_dump(), author_id=current_user.id)
    db.add(post)
    db.commit()
    db.refresh(post)
    return post


@router.put("/{post_id}", response_model=PostOut)
def update_post(
    post_id: int,
    payload: PostUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Post:
    """Update a post. Authors may edit their own; admins may edit any."""
    post = _get_post_or_404(post_id, db)
    if not _can_manage(current_user, post):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to modify this post"
        )
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(post, field, value)
    db.commit()
    db.refresh(post)
    return post


@router.delete("/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_post(
    post_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    """Delete a post. Authors may delete their own; admins may delete any."""
    post = _get_post_or_404(post_id, db)
    if not _can_manage(current_user, post):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Not allowed to delete this post"
        )
    db.delete(post)
    db.commit()
