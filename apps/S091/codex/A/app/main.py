from fastapi import Depends, FastAPI, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db, init_db
from app.models import FeedItem, Follow, Post, User
from app.queue import enqueue
from app.schemas import FollowCreate, PostCreate, PostOut, UserCreate, UserOut
from app.tasks import extract_urls


app = FastAPI(title="FastAPI Microblog")
templates = Jinja2Templates(directory="app/templates")
app.mount("/static", StaticFiles(directory="app/static"), name="static")


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/", response_class=HTMLResponse)
def home(request: Request, user_id: int | None = None, db: Session = Depends(get_db)) -> HTMLResponse:
    users = list(db.scalars(select(User).order_by(User.username)))
    selected = db.get(User, user_id) if user_id else (users[0] if users else None)
    timeline = []
    following_ids: set[int] = set()

    if selected:
        timeline = list(
            db.scalars(
                select(FeedItem)
                .options(joinedload(FeedItem.post).joinedload(Post.author), joinedload(FeedItem.post).joinedload(Post.previews))
                .where(FeedItem.user_id == selected.id)
                .order_by(FeedItem.created_at.desc())
                .limit(100)
            )
            .unique()
        )
        following_ids = set(db.scalars(select(Follow.followee_id).where(Follow.follower_id == selected.id)))

    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "users": users,
            "selected": selected,
            "timeline": timeline,
            "following_ids": following_ids,
        },
    )


@app.post("/ui/users")
def ui_create_user(
    username: str = Form(...),
    display_name: str = Form(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    user = create_user(UserCreate(username=username, display_name=display_name), db)
    enqueue("app.tasks.rebuild_user_feed", user.id)
    return RedirectResponse(f"/?user_id={user.id}", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/ui/posts")
def ui_create_post(
    user_id: int = Form(...),
    body: str = Form(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    create_post(PostCreate(user_id=user_id, body=body), db)
    return RedirectResponse(f"/?user_id={user_id}", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/ui/follows")
def ui_follow(
    follower_id: int = Form(...),
    followee_id: int = Form(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    create_follow(FollowCreate(follower_id=follower_id, followee_id=followee_id), db)
    return RedirectResponse(f"/?user_id={follower_id}", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/ui/unfollow")
def ui_unfollow(
    follower_id: int = Form(...),
    followee_id: int = Form(...),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    delete_follow(follower_id, followee_id, db)
    return RedirectResponse(f"/?user_id={follower_id}", status_code=status.HTTP_303_SEE_OTHER)


@app.post("/api/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: Session = Depends(get_db)) -> User:
    user = User(username=payload.username, display_name=payload.display_name)
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="username already exists") from exc
    db.refresh(user)
    return user


@app.get("/api/users", response_model=list[UserOut])
def list_users(db: Session = Depends(get_db)) -> list[User]:
    return list(db.scalars(select(User).order_by(User.username)))


@app.post("/api/posts", response_model=PostOut, status_code=status.HTTP_201_CREATED)
def create_post(payload: PostCreate, db: Session = Depends(get_db)) -> Post:
    author = db.get(User, payload.user_id)
    if author is None:
        raise HTTPException(status_code=404, detail="user not found")

    post = Post(user_id=payload.user_id, body=payload.body)
    db.add(post)
    db.commit()
    db.refresh(post)

    enqueue("app.tasks.rebuild_author_audience", payload.user_id)
    if extract_urls(payload.body):
        enqueue("app.tasks.fetch_link_previews", post.id)

    return (
        db.execute(
            select(Post)
            .options(joinedload(Post.author), joinedload(Post.previews))
            .where(Post.id == post.id)
        )
        .unique()
        .scalar_one()
    )


@app.get("/api/posts", response_model=list[PostOut])
def list_posts(db: Session = Depends(get_db)) -> list[Post]:
    return list(
        db.scalars(
            select(Post)
            .options(joinedload(Post.author), joinedload(Post.previews))
            .order_by(Post.created_at.desc())
            .limit(100)
        )
        .unique()
    )


@app.post("/api/follows", status_code=status.HTTP_201_CREATED)
def create_follow(payload: FollowCreate, db: Session = Depends(get_db)) -> dict[str, str]:
    if payload.follower_id == payload.followee_id:
        raise HTTPException(status_code=400, detail="users cannot follow themselves")
    if db.get(User, payload.follower_id) is None or db.get(User, payload.followee_id) is None:
        raise HTTPException(status_code=404, detail="user not found")

    db.add(Follow(follower_id=payload.follower_id, followee_id=payload.followee_id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()

    enqueue("app.tasks.rebuild_user_feed", payload.follower_id)
    return {"status": "following"}


@app.delete("/api/follows/{follower_id}/{followee_id}")
def delete_follow(follower_id: int, followee_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    db.execute(
        delete(Follow).where(
            Follow.follower_id == follower_id,
            Follow.followee_id == followee_id,
        )
    )
    db.commit()
    enqueue("app.tasks.rebuild_user_feed", follower_id)
    return {"status": "unfollowed"}


@app.get("/api/timeline/{user_id}", response_model=list[PostOut])
def timeline(user_id: int, db: Session = Depends(get_db)) -> list[Post]:
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="user not found")

    items = list(
        db.scalars(
            select(FeedItem)
            .options(joinedload(FeedItem.post).joinedload(Post.author), joinedload(FeedItem.post).joinedload(Post.previews))
            .where(FeedItem.user_id == user_id)
            .order_by(FeedItem.created_at.desc())
            .limit(100)
        )
        .unique()
    )
    return [item.post for item in items]


@app.post("/api/feeds/rebuild/{user_id}")
def rebuild_feed(user_id: int, db: Session = Depends(get_db)) -> dict[str, str]:
    if db.get(User, user_id) is None:
        raise HTTPException(status_code=404, detail="user not found")
    job_id = enqueue("app.tasks.rebuild_user_feed", user_id)
    return {"job_id": job_id}
