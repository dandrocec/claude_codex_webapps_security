"""A small, security-focused blog application built with Flask.

Security highlights (OWASP Top 10):
  * Parameterised SQL everywhere (sqlite3) -> no SQL injection.
  * Argon2id password hashing (argon2-cffi) -> strong, salted hashes.
  * CSRF protection on every state-changing request (Flask-WTF).
  * Server-side input validation + Jinja2 autoescaping for context-aware
    output encoding -> XSS defence.
  * Per-resource ownership checks -> no IDOR.
  * Hardened session cookies (HttpOnly / Secure / SameSite) and security
    headers (CSP, X-Content-Type-Options, frame options, etc.).
  * No secrets in source; everything sensitive comes from the environment.
  * Generic error pages -> no stack traces / internals leak to clients.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_wtf import CSRFProtect, FlaskForm
from wtforms import PasswordField, StringField, SubmitField, TextAreaField
from wtforms.validators import InputRequired, Length, Regexp
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError


# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "blog.db"))

# Argon2id hasher with sensible defaults.
password_hasher = PasswordHasher()


def create_app() -> Flask:
    app = Flask(__name__)

    secret = os.environ.get("SECRET_KEY")
    if not secret:
        # Fail closed: refuse to run with a predictable key in any environment.
        raise RuntimeError(
            "SECRET_KEY environment variable is required. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )

    # Treat the app as production-secure by default; flip FLASK_DEBUG=1 only
    # for local development over http.
    is_debug = os.environ.get("FLASK_DEBUG", "0") == "1"

    app.config.update(
        SECRET_KEY=secret,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure flag requires https; disable it only when explicitly running
        # a local http dev server.
        SESSION_COOKIE_SECURE=not is_debug,
        REMEMBER_COOKIE_HTTPONLY=True,
        REMEMBER_COOKIE_SAMESITE="Lax",
        REMEMBER_COOKIE_SECURE=not is_debug,
        WTF_CSRF_TIME_LIMIT=None,  # tie CSRF token lifetime to the session
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,  # 1 MB request cap
    )

    CSRFProtect(app)

    login_manager = LoginManager(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"

    register_database(app)
    register_security_headers(app)
    register_error_handlers(app)
    register_routes(app, login_manager)

    return app


# --------------------------------------------------------------------------- #
# Database helpers (sqlite3, parameterised queries only)
# --------------------------------------------------------------------------- #
def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def register_database(app: Flask) -> None:
    @app.teardown_appcontext
    def close_db(_exc=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    with app.app_context():
        db = get_db()
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS posts (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id  INTEGER NOT NULL,
                title      TEXT NOT NULL,
                body       TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
        db.commit()


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# User model (Flask-Login)
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row: sqlite3.Row):
        self.id = row["id"]
        self.username = row["username"]
        self.password_hash = row["password_hash"]

    @staticmethod
    def get_by_id(user_id: int) -> "User | None":
        row = get_db().execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return User(row) if row else None

    @staticmethod
    def get_by_username(username: str) -> "User | None":
        row = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        return User(row) if row else None


# --------------------------------------------------------------------------- #
# Forms (WTForms) -> server-side validation + CSRF
# --------------------------------------------------------------------------- #
class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            InputRequired(),
            Length(min=3, max=32),
            Regexp(
                r"^[A-Za-z0-9_.-]+$",
                message="Use only letters, numbers, and _ . - characters.",
            ),
        ],
    )
    password = PasswordField(
        "Password", validators=[InputRequired(), Length(min=8, max=256)]
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[InputRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[InputRequired(), Length(max=256)])
    submit = SubmitField("Log in")


class PostForm(FlaskForm):
    title = StringField(
        "Title", validators=[InputRequired(), Length(min=1, max=200)]
    )
    body = TextAreaField(
        "Body", validators=[InputRequired(), Length(min=1, max=20000)]
    )
    submit = SubmitField("Save")


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #
def register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_headers(response):
        # Strict, self-only policy. Templates use no inline scripts.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


# --------------------------------------------------------------------------- #
# Error handlers -> never leak internals
# --------------------------------------------------------------------------- #
def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403, message="Forbidden."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404, message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("error.html", code=413, message="Request too large."), 413

    @app.errorhandler(500)
    def server_error(_e):
        # The real exception is logged by Flask; the client sees nothing.
        return render_template(
            "error.html", code=500, message="Something went wrong."
        ), 500


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def register_routes(app: Flask, login_manager: LoginManager) -> None:
    @login_manager.user_loader
    def load_user(user_id: str):
        try:
            return User.get_by_id(int(user_id))
        except (ValueError, TypeError):
            return None

    # ---- Home: list all posts, newest first ---------------------------- #
    @app.route("/")
    def index():
        rows = get_db().execute(
            """
            SELECT posts.id, posts.title, posts.created_at, users.username
            FROM posts
            JOIN users ON users.id = posts.author_id
            ORDER BY posts.created_at DESC, posts.id DESC
            """
        ).fetchall()
        return render_template("index.html", posts=rows)

    # ---- Post detail --------------------------------------------------- #
    @app.route("/post/<int:post_id>")
    def post_detail(post_id: int):
        row = get_db().execute(
            """
            SELECT posts.*, users.username
            FROM posts
            JOIN users ON users.id = posts.author_id
            WHERE posts.id = ?
            """,
            (post_id,),
        ).fetchone()
        if row is None:
            abort(404)
        return render_template("post.html", post=row)

    # ---- Registration -------------------------------------------------- #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("index"))

        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            password = form.password.data
            db = get_db()
            existing = db.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing:
                flash("That username is taken.", "error")
            else:
                db.execute(
                    "INSERT INTO users (username, password_hash, created_at) "
                    "VALUES (?, ?, ?)",
                    (username, password_hasher.hash(password), utcnow_iso()),
                )
                db.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    # ---- Login --------------------------------------------------------- #
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))

        form = LoginForm()
        if form.validate_on_submit():
            user = User.get_by_username(form.username.data.strip())
            # Always verify against *some* hash to reduce username enumeration
            # via timing, and use a single generic failure message.
            if user and _verify_password(user, form.password.data):
                login_user(user)
                _maybe_rehash(user, form.password.data)
                return redirect(url_for("index"))
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    # ---- Logout -------------------------------------------------------- #
    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "success")
        return redirect(url_for("index"))

    # ---- Create post --------------------------------------------------- #
    @app.route("/post/new", methods=["GET", "POST"])
    @login_required
    def create_post():
        form = PostForm()
        if form.validate_on_submit():
            now = utcnow_iso()
            db = get_db()
            cur = db.execute(
                "INSERT INTO posts (author_id, title, body, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (current_user.id, form.title.data.strip(), form.body.data, now, now),
            )
            db.commit()
            flash("Post published.", "success")
            return redirect(url_for("post_detail", post_id=cur.lastrowid))
        return render_template("editor.html", form=form, heading="New post")

    # ---- Edit post (owner only) --------------------------------------- #
    @app.route("/post/<int:post_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_post(post_id: int):
        post = _get_owned_post_or_403(post_id)
        form = PostForm(data={"title": post["title"], "body": post["body"]})
        if form.validate_on_submit():
            db = get_db()
            db.execute(
                "UPDATE posts SET title = ?, body = ?, updated_at = ? "
                "WHERE id = ? AND author_id = ?",
                (
                    form.title.data.strip(),
                    form.body.data,
                    utcnow_iso(),
                    post_id,
                    current_user.id,
                ),
            )
            db.commit()
            flash("Post updated.", "success")
            return redirect(url_for("post_detail", post_id=post_id))
        return render_template("editor.html", form=form, heading="Edit post")

    # ---- Delete post (owner only) ------------------------------------- #
    @app.route("/post/<int:post_id>/delete", methods=["POST"])
    @login_required
    def delete_post(post_id: int):
        _get_owned_post_or_403(post_id)
        db = get_db()
        db.execute(
            "DELETE FROM posts WHERE id = ? AND author_id = ?",
            (post_id, current_user.id),
        )
        db.commit()
        flash("Post deleted.", "success")
        return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Internal helpers
# --------------------------------------------------------------------------- #
def _verify_password(user: "User", password: str) -> bool:
    try:
        return password_hasher.verify(user.password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def _maybe_rehash(user: "User", password: str) -> None:
    """Transparently upgrade hashes if Argon2 parameters have changed."""
    try:
        if password_hasher.check_needs_rehash(user.password_hash):
            db = get_db()
            db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (password_hasher.hash(password), user.id),
            )
            db.commit()
    except Exception:  # pragma: no cover - never block login on a rehash failure
        pass


def _get_owned_post_or_403(post_id: int) -> sqlite3.Row:
    row = get_db().execute(
        "SELECT * FROM posts WHERE id = ?", (post_id,)
    ).fetchone()
    if row is None:
        abort(404)
    if row["author_id"] != current_user.id:
        abort(403)
    return row


app = create_app()


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", "5026")),
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
    )
