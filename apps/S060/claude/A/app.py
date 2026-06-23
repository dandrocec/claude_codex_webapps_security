"""A small Flask blog with reader / author / editor roles.

Run with:  python app.py   (serves on http://127.0.0.1:5060)
"""
import os
from datetime import datetime
from functools import wraps

from flask import (
    Flask, render_template, request, redirect, url_for, flash, abort, session
)
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy import create_engine, ForeignKey, String, Text, DateTime, select
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship, Session
)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "blog.db")

ROLES = ("reader", "author", "editor")
STATUS_DRAFT = "draft"
STATUS_SUBMITTED = "submitted"
STATUS_APPROVED = "approved"
STATUS_REJECTED = "rejected"


# --------------------------------------------------------------------------- #
# Database models
# --------------------------------------------------------------------------- #
class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="reader")

    posts: Mapped[list["Post"]] = relationship(back_populates="author")

    def set_password(self, password: str) -> None:
        self.password_hash = generate_password_hash(password)

    def check_password(self, password: str) -> bool:
        return check_password_hash(self.password_hash, password)


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=STATUS_DRAFT)
    review_note: Mapped[str] = mapped_column(Text, nullable=True)

    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    author: Mapped["User"] = relationship(back_populates="posts")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)


# --------------------------------------------------------------------------- #
# App factory
# --------------------------------------------------------------------------- #
def create_app() -> Flask:
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def current_user():
        uid = session.get("user_id")
        if uid is None:
            return None
        with Session(engine) as db:
            return db.get(User, uid)

    @app.context_processor
    def inject_user():
        return {"current_user": current_user(), "ROLES": ROLES}

    def login_required(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if session.get("user_id") is None:
                flash("Please log in to continue.", "error")
                return redirect(url_for("login", next=request.path))
            return view(*args, **kwargs)
        return wrapped

    def role_required(*roles):
        def decorator(view):
            @wraps(view)
            def wrapped(*args, **kwargs):
                user = current_user()
                if user is None:
                    flash("Please log in to continue.", "error")
                    return redirect(url_for("login", next=request.path))
                if user.role not in roles:
                    abort(403)
                return view(*args, **kwargs)
            return wrapped
        return decorator

    # ------------------------------------------------------------------ #
    # Public pages
    # ------------------------------------------------------------------ #
    @app.route("/")
    def index():
        with Session(engine) as db:
            posts = db.scalars(
                select(Post)
                .where(Post.status == STATUS_APPROVED)
                .order_by(Post.updated_at.desc())
            ).all()
            # touch author relationship while session is open
            for p in posts:
                _ = p.author.username
        return render_template("index.html", posts=posts)

    @app.route("/post/<int:post_id>")
    def view_post(post_id):
        with Session(engine) as db:
            post = db.get(Post, post_id)
            if post is None:
                abort(404)
            user = current_user()
            # Approved posts are public; otherwise only the author/editor may view.
            if post.status != STATUS_APPROVED:
                if user is None or (
                    user.role != "editor" and user.id != post.author_id
                ):
                    abort(403)
            _ = post.author.username
        return render_template("post_detail.html", post=post)

    # ------------------------------------------------------------------ #
    # Auth
    # ------------------------------------------------------------------ #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            role = request.form.get("role", "reader")
            if role not in ROLES:
                role = "reader"
            if not username or not password:
                flash("Username and password are required.", "error")
                return render_template("register.html")
            with Session(engine) as db:
                exists = db.scalar(select(User).where(User.username == username))
                if exists:
                    flash("That username is taken.", "error")
                    return render_template("register.html")
                user = User(username=username, role=role)
                user.set_password(password)
                db.add(user)
                db.commit()
                session["user_id"] = user.id
            flash(f"Welcome, {username}! You are registered as a {role}.", "success")
            return redirect(url_for("dashboard"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            with Session(engine) as db:
                user = db.scalar(select(User).where(User.username == username))
                if user is None or not user.check_password(password):
                    flash("Invalid username or password.", "error")
                    return render_template("login.html")
                session["user_id"] = user.id
            flash(f"Welcome back, {username}!", "success")
            nxt = request.args.get("next") or url_for("dashboard")
            return redirect(nxt)
        return render_template("login.html")

    @app.route("/logout")
    def logout():
        session.clear()
        flash("You have been logged out.", "success")
        return redirect(url_for("index"))

    # ------------------------------------------------------------------ #
    # Dashboard (role-aware)
    # ------------------------------------------------------------------ #
    @app.route("/dashboard")
    @login_required
    def dashboard():
        user = current_user()
        with Session(engine) as db:
            if user.role == "author":
                posts = db.scalars(
                    select(Post)
                    .where(Post.author_id == user.id)
                    .order_by(Post.updated_at.desc())
                ).all()
                for p in posts:
                    _ = p.author.username
                return render_template("dashboard_author.html", posts=posts)

            if user.role == "editor":
                pending = db.scalars(
                    select(Post)
                    .where(Post.status == STATUS_SUBMITTED)
                    .order_by(Post.updated_at.asc())
                ).all()
                reviewed = db.scalars(
                    select(Post)
                    .where(Post.status.in_([STATUS_APPROVED, STATUS_REJECTED]))
                    .order_by(Post.updated_at.desc())
                ).all()
                for p in [*pending, *reviewed]:
                    _ = p.author.username
                return render_template(
                    "dashboard_editor.html", pending=pending, reviewed=reviewed
                )

            # reader
            posts = db.scalars(
                select(Post)
                .where(Post.status == STATUS_APPROVED)
                .order_by(Post.updated_at.desc())
            ).all()
            for p in posts:
                _ = p.author.username
            return render_template("dashboard_reader.html", posts=posts)

    # ------------------------------------------------------------------ #
    # Author actions
    # ------------------------------------------------------------------ #
    @app.route("/posts/new", methods=["GET", "POST"])
    @role_required("author")
    def new_post():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            body = request.form.get("body", "").strip()
            action = request.form.get("action", "save")
            if not title or not body:
                flash("Title and body are required.", "error")
                return render_template("post_form.html", post=None)
            user = current_user()
            with Session(engine) as db:
                post = Post(
                    title=title,
                    body=body,
                    author_id=user.id,
                    status=STATUS_SUBMITTED if action == "submit" else STATUS_DRAFT,
                )
                db.add(post)
                db.commit()
            flash(
                "Post submitted for review." if action == "submit"
                else "Draft saved.",
                "success",
            )
            return redirect(url_for("dashboard"))
        return render_template("post_form.html", post=None)

    def _load_own_post(db, post_id):
        post = db.get(Post, post_id)
        if post is None:
            abort(404)
        if post.author_id != session.get("user_id"):
            abort(403)
        return post

    @app.route("/posts/<int:post_id>/edit", methods=["GET", "POST"])
    @role_required("author")
    def edit_post(post_id):
        with Session(engine) as db:
            post = _load_own_post(db, post_id)
            if request.method == "POST":
                if post.status not in (STATUS_DRAFT, STATUS_REJECTED):
                    flash("Only drafts or rejected posts can be edited.", "error")
                    return redirect(url_for("dashboard"))
                title = request.form.get("title", "").strip()
                body = request.form.get("body", "").strip()
                action = request.form.get("action", "save")
                if not title or not body:
                    flash("Title and body are required.", "error")
                    return render_template("post_form.html", post=post)
                post.title = title
                post.body = body
                if action == "submit":
                    post.status = STATUS_SUBMITTED
                    post.review_note = None
                db.commit()
                flash(
                    "Post submitted for review." if action == "submit"
                    else "Changes saved.",
                    "success",
                )
                return redirect(url_for("dashboard"))
            return render_template("post_form.html", post=post)

    @app.route("/posts/<int:post_id>/submit", methods=["POST"])
    @role_required("author")
    def submit_post(post_id):
        with Session(engine) as db:
            post = _load_own_post(db, post_id)
            if post.status in (STATUS_DRAFT, STATUS_REJECTED):
                post.status = STATUS_SUBMITTED
                post.review_note = None
                db.commit()
                flash("Post submitted for review.", "success")
            else:
                flash("This post cannot be submitted.", "error")
        return redirect(url_for("dashboard"))

    @app.route("/posts/<int:post_id>/delete", methods=["POST"])
    @role_required("author")
    def delete_post(post_id):
        with Session(engine) as db:
            post = _load_own_post(db, post_id)
            db.delete(post)
            db.commit()
        flash("Post deleted.", "success")
        return redirect(url_for("dashboard"))

    # ------------------------------------------------------------------ #
    # Editor actions
    # ------------------------------------------------------------------ #
    @app.route("/posts/<int:post_id>/review", methods=["POST"])
    @role_required("editor")
    def review_post(post_id):
        decision = request.form.get("decision")
        note = request.form.get("note", "").strip()
        with Session(engine) as db:
            post = db.get(Post, post_id)
            if post is None:
                abort(404)
            if post.status != STATUS_SUBMITTED:
                flash("Only submitted posts can be reviewed.", "error")
                return redirect(url_for("dashboard"))
            if decision == "approve":
                post.status = STATUS_APPROVED
                post.review_note = note or None
                flash(f'Approved "{post.title}".', "success")
            elif decision == "reject":
                post.status = STATUS_REJECTED
                post.review_note = note or "No reason given."
                flash(f'Rejected "{post.title}".', "success")
            else:
                flash("Unknown decision.", "error")
                return redirect(url_for("dashboard"))
            db.commit()
        return redirect(url_for("dashboard"))

    # ------------------------------------------------------------------ #
    # Error handlers
    # ------------------------------------------------------------------ #
    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You don't have access to that."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    return app


# --------------------------------------------------------------------------- #
# DB bootstrap + demo seed
# --------------------------------------------------------------------------- #
def init_db(seed: bool = True) -> None:
    Base.metadata.create_all(engine)
    if not seed:
        return
    with Session(engine) as db:
        if db.scalar(select(User).limit(1)):
            return  # already seeded

        reader = User(username="reader", role="reader")
        reader.set_password("password")
        author = User(username="author", role="author")
        author.set_password("password")
        editor = User(username="editor", role="editor")
        editor.set_password("password")
        db.add_all([reader, author, editor])
        db.commit()

        demo = [
            Post(title="Welcome to the blog",
                 body="This post was approved and is visible to everyone.\n\n"
                      "Log in as the editor to review submissions, or as the "
                      "author to write new posts.",
                 status=STATUS_APPROVED, author_id=author.id),
            Post(title="A draft in progress",
                 body="Only the author can see this draft until it is submitted "
                      "and approved.",
                 status=STATUS_DRAFT, author_id=author.id),
            Post(title="Please review me",
                 body="This post is waiting in the editor's queue.",
                 status=STATUS_SUBMITTED, author_id=author.id),
        ]
        db.add_all(demo)
        db.commit()


app = create_app()


if __name__ == "__main__":
    init_db(seed=True)
    app.run(host="127.0.0.1", port=5060, debug=True)
