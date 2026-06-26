import os
import re
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from html import unescape
from pathlib import Path

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_bcrypt import Bcrypt
from flask_wtf import CSRFProtect, FlaskForm
from markupsafe import Markup, escape
from wtforms import HiddenField, PasswordField, SelectField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Email, EqualTo, Length, Regexp, ValidationError


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "instance" / "blog.sqlite3"
ROLES = {"reader", "author", "editor"}
POST_STATUSES = {"draft", "submitted", "approved", "rejected"}


app = Flask(__name__)
secret_key = os.environ.get("FLASK_SECRET_KEY")
if not secret_key:
    raise RuntimeError("FLASK_SECRET_KEY environment variable is required")

app.config.update(
    SECRET_KEY=secret_key,
    WTF_CSRF_TIME_LIMIT=3600,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=1024 * 1024,
)

bcrypt = Bcrypt(app)
csrf = CSRFProtect(app)


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def get_db():
    if "db" not in g:
        DATABASE.parent.mkdir(exist_ok=True)
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('reader', 'author', 'editor')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
            rejection_reason TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            submitted_at TEXT,
            reviewed_at TEXT,
            reviewed_by INTEGER,
            FOREIGN KEY(author_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY(reviewed_by) REFERENCES users(id) ON DELETE SET NULL
        );
        """
    )
    db.commit()


@app.before_request
def prepare_request():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id:
        g.user = query_one("SELECT id, username, email, role FROM users WHERE id = ?", (user_id,))
        if g.user is None:
            session.clear()


@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self'; "
        "script-src 'self'; "
        "img-src 'self' data:; "
        "base-uri 'self'; "
        "form-action 'self'; "
        "frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    cursor = db.execute(sql, params)
    db.commit()
    return cursor


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def role_required(*roles):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if g.user is None:
                flash("Please sign in to continue.", "warning")
                return redirect(url_for("login", next=request.path))
            if g.user["role"] not in roles:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            Regexp(r"^[A-Za-z0-9_]+$", message="Use letters, numbers, and underscores only."),
        ],
    )
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    role = SelectField("Role", choices=[("reader", "Reader"), ("author", "Author"), ("editor", "Editor")])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=12, max=128)])
    confirm_password = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    submit = SubmitField("Create account")

    def validate_password(self, field):
        password = field.data or ""
        if not re.search(r"[A-Z]", password) or not re.search(r"[a-z]", password):
            raise ValidationError("Password must include upper and lower case letters.")
        if not re.search(r"\d", password):
            raise ValidationError("Password must include a number.")
        if not re.search(r"[^A-Za-z0-9]", password):
            raise ValidationError("Password must include a symbol.")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(min=3, max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Sign in")


class PostForm(FlaskForm):
    title = StringField("Title", validators=[DataRequired(), Length(min=3, max=140)])
    body = TextAreaField("Body", validators=[DataRequired(), Length(min=20, max=12000)])
    submit = SubmitField("Save draft")


class RejectForm(FlaskForm):
    reason = TextAreaField("Reason", validators=[DataRequired(), Length(min=5, max=1000)])
    submit = SubmitField("Reject")


class EmptyActionForm(FlaskForm):
    post_id = HiddenField("Post ID", validators=[DataRequired()])
    submit = SubmitField("Submit")


def plain_text(value):
    cleaned = unescape(value or "").replace("\x00", "")
    return re.sub(r"[\r\t ]+\n", "\n", cleaned).strip()


def nl2br(value):
    return Markup("<br>".join(escape(value).splitlines()))


app.jinja_env.filters["nl2br"] = nl2br


@app.route("/")
def index():
    posts = query_all(
        """
        SELECT posts.id, posts.title, posts.body, posts.approved_at, posts.updated_at, users.username AS author
        FROM (
            SELECT id, title, body, updated_at AS approved_at, updated_at, author_id, status
            FROM posts
        ) posts
        JOIN users ON users.id = posts.author_id
        WHERE posts.status = ?
        ORDER BY posts.updated_at DESC
        """,
        ("approved",),
    )
    return render_template("index.html", posts=posts)


@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("dashboard"))
    form = RegisterForm()
    if form.validate_on_submit():
        username = plain_text(form.username.data)
        email = plain_text(form.email.data).lower()
        role = form.role.data if form.role.data in ROLES else "reader"
        existing = query_one("SELECT id FROM users WHERE username = ? OR email = ?", (username, email))
        if existing:
            flash("Username or email is already registered.", "danger")
        else:
            password_hash = bcrypt.generate_password_hash(form.password.data).decode("utf-8")
            execute(
                """
                INSERT INTO users (username, email, password_hash, role, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (username, email, password_hash, role, now_iso()),
            )
            flash("Account created. Please sign in.", "success")
            return redirect(url_for("login"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("dashboard"))
    form = LoginForm()
    if form.validate_on_submit():
        username = plain_text(form.username.data)
        user = query_one("SELECT * FROM users WHERE username = ?", (username,))
        if user and bcrypt.check_password_hash(user["password_hash"], form.password.data):
            session.clear()
            session["user_id"] = user["id"]
            session["role"] = user["role"]
            next_url = request.args.get("next")
            if next_url and next_url.startswith("/") and not next_url.startswith("//"):
                return redirect(next_url)
            return redirect(url_for("dashboard"))
        flash("Invalid username or password.", "danger")
    return render_template("login.html", form=form)


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    if g.user["role"] == "author":
        posts = query_all(
            "SELECT * FROM posts WHERE author_id = ? ORDER BY updated_at DESC",
            (g.user["id"],),
        )
        submit_form = EmptyActionForm()
        delete_form = EmptyActionForm()
        return render_template("dashboard_author.html", posts=posts, submit_form=submit_form, delete_form=delete_form)
    if g.user["role"] == "editor":
        submitted = query_all(
            """
            SELECT posts.*, users.username AS author
            FROM posts JOIN users ON users.id = posts.author_id
            WHERE posts.status = ?
            ORDER BY posts.submitted_at ASC
            """,
            ("submitted",),
        )
        approved = query_all(
            """
            SELECT posts.*, users.username AS author
            FROM posts JOIN users ON users.id = posts.author_id
            WHERE posts.status = ?
            ORDER BY posts.reviewed_at DESC
            LIMIT 10
            """,
            ("approved",),
        )
        approve_form = EmptyActionForm()
        return render_template(
            "dashboard_editor.html",
            submitted=submitted,
            approved=approved,
            approve_form=approve_form,
        )
    posts = query_all(
        """
        SELECT posts.id, posts.title, posts.updated_at, users.username AS author
        FROM posts JOIN users ON users.id = posts.author_id
        WHERE posts.status = ?
        ORDER BY posts.updated_at DESC
        """,
        ("approved",),
    )
    return render_template("dashboard_reader.html", posts=posts)


@app.route("/posts/<int:post_id>")
def post_detail(post_id):
    post = query_one(
        """
        SELECT posts.*, users.username AS author
        FROM posts JOIN users ON users.id = posts.author_id
        WHERE posts.id = ?
        """,
        (post_id,),
    )
    if post is None:
        abort(404)
    can_view_private = (
        g.user
        and (
            (g.user["role"] == "author" and post["author_id"] == g.user["id"])
            or g.user["role"] == "editor"
        )
    )
    if post["status"] != "approved" and not can_view_private:
        abort(404)
    return render_template("post_detail.html", post=post)


@app.route("/author/posts/new", methods=["GET", "POST"])
@role_required("author")
def new_post():
    form = PostForm()
    if form.validate_on_submit():
        title = plain_text(form.title.data)
        body = plain_text(form.body.data)
        execute(
            """
            INSERT INTO posts (author_id, title, body, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (g.user["id"], title, body, "draft", now_iso(), now_iso()),
        )
        flash("Draft saved.", "success")
        return redirect(url_for("dashboard"))
    return render_template("post_form.html", form=form, heading="New post")


@app.route("/author/posts/<int:post_id>/edit", methods=["GET", "POST"])
@role_required("author")
def edit_post(post_id):
    post = query_one("SELECT * FROM posts WHERE id = ? AND author_id = ?", (post_id, g.user["id"]))
    if post is None:
        abort(404)
    if post["status"] == "approved":
        abort(403)
    form = PostForm(data={"title": post["title"], "body": post["body"]})
    if form.validate_on_submit():
        status = "draft" if post["status"] in {"submitted", "rejected"} else post["status"]
        execute(
            """
            UPDATE posts
            SET title = ?, body = ?, status = ?, rejection_reason = NULL,
                submitted_at = NULL, reviewed_at = NULL, reviewed_by = NULL, updated_at = ?
            WHERE id = ? AND author_id = ?
            """,
            (plain_text(form.title.data), plain_text(form.body.data), status, now_iso(), post_id, g.user["id"]),
        )
        flash("Post updated.", "success")
        return redirect(url_for("dashboard"))
    return render_template("post_form.html", form=form, heading="Edit post")


@app.route("/author/posts/<int:post_id>/submit", methods=["POST"])
@role_required("author")
def submit_post(post_id):
    post = query_one("SELECT * FROM posts WHERE id = ? AND author_id = ?", (post_id, g.user["id"]))
    if post is None:
        abort(404)
    if post["status"] not in {"draft", "rejected"}:
        abort(403)
    execute(
        """
        UPDATE posts
        SET status = ?, submitted_at = ?, updated_at = ?, rejection_reason = NULL
        WHERE id = ? AND author_id = ?
        """,
        ("submitted", now_iso(), now_iso(), post_id, g.user["id"]),
    )
    flash("Post submitted for review.", "success")
    return redirect(url_for("dashboard"))


@app.route("/author/posts/<int:post_id>/delete", methods=["POST"])
@role_required("author")
def delete_post(post_id):
    post = query_one("SELECT id, status FROM posts WHERE id = ? AND author_id = ?", (post_id, g.user["id"]))
    if post is None:
        abort(404)
    if post["status"] == "approved":
        abort(403)
    execute("DELETE FROM posts WHERE id = ? AND author_id = ?", (post_id, g.user["id"]))
    flash("Post deleted.", "info")
    return redirect(url_for("dashboard"))


@app.route("/editor/posts/<int:post_id>/approve", methods=["POST"])
@role_required("editor")
def approve_post(post_id):
    post = query_one("SELECT id FROM posts WHERE id = ? AND status = ?", (post_id, "submitted"))
    if post is None:
        abort(404)
    execute(
        """
        UPDATE posts
        SET status = ?, reviewed_at = ?, reviewed_by = ?, rejection_reason = NULL, updated_at = ?
        WHERE id = ? AND status = ?
        """,
        ("approved", now_iso(), g.user["id"], now_iso(), post_id, "submitted"),
    )
    flash("Post approved.", "success")
    return redirect(url_for("dashboard"))


@app.route("/editor/posts/<int:post_id>/reject", methods=["GET", "POST"])
@role_required("editor")
def reject_post(post_id):
    post = query_one(
        """
        SELECT posts.*, users.username AS author
        FROM posts JOIN users ON users.id = posts.author_id
        WHERE posts.id = ? AND posts.status = ?
        """,
        (post_id, "submitted"),
    )
    if post is None:
        abort(404)
    form = RejectForm()
    if form.validate_on_submit():
        execute(
            """
            UPDATE posts
            SET status = ?, rejection_reason = ?, reviewed_at = ?, reviewed_by = ?, updated_at = ?
            WHERE id = ? AND status = ?
            """,
            ("rejected", plain_text(form.reason.data), now_iso(), g.user["id"], now_iso(), post_id, "submitted"),
        )
        flash("Post rejected.", "info")
        return redirect(url_for("dashboard"))
    return render_template("reject_post.html", post=post, form=form)


@app.errorhandler(400)
def bad_request(_error):
    return render_template("error.html", title="Bad request", message="The request could not be processed."), 400


@app.errorhandler(403)
def forbidden(_error):
    return render_template("error.html", title="Forbidden", message="You do not have access to this action."), 403


@app.errorhandler(404)
def not_found(_error):
    return render_template("error.html", title="Not found", message="The requested page was not found."), 404


@app.errorhandler(413)
def too_large(_error):
    return render_template("error.html", title="Too large", message="The submitted content is too large."), 413


@app.errorhandler(500)
def server_error(_error):
    return render_template("error.html", title="Server error", message="An internal error occurred."), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5060, debug=False)
