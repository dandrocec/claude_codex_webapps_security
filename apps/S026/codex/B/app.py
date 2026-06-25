import os
import re
import sqlite3
from datetime import datetime, timezone
from functools import wraps
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
from flask_wtf import CSRFProtect
from markupsafe import Markup, escape
from werkzeug.exceptions import HTTPException


BASE_DIR = Path(__file__).resolve().parent
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
MAX_TITLE_LENGTH = 140
MAX_BODY_LENGTH = 10000


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get("DATABASE", str(BASE_DIR / "blog.sqlite3")),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        not in {"0", "false", "no"},
        SESSION_COOKIE_SAMESITE="Lax",
        WTF_CSRF_TIME_LIMIT=3600,
        MAX_CONTENT_LENGTH=128 * 1024,
    )

    bcrypt = Bcrypt(app)
    CSRFProtect(app)
    app.teardown_appcontext(close_db)

    @app.before_request
    def load_logged_in_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = query_one(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            )
            if g.user is None:
                session.clear()

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "script-src 'self'; "
            "style-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.template_filter("nl2br")
    def nl2br(value):
        escaped = escape(value or "")
        return Markup("<br>".join(str(escaped).splitlines()))

    @app.route("/")
    def index():
        posts = query_all(
            """
            SELECT posts.id, posts.title, posts.body, posts.created_at, users.username
            FROM posts
            JOIN users ON posts.user_id = users.id
            ORDER BY posts.created_at DESC, posts.id DESC
            """
        )
        return render_template("index.html", posts=posts)

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            username = clean_text(request.form.get("username", ""))
            password = request.form.get("password", "")

            error = validate_username(username) or validate_password(password)
            if error is None:
                password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
                try:
                    execute_db(
                        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                        (username, password_hash),
                    )
                except sqlite3.IntegrityError:
                    error = "Registration failed. Choose different credentials."
                else:
                    flash("Registration complete. Please log in.", "success")
                    return redirect(url_for("login"))

            flash(error, "error")

        return render_template("register.html")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "POST":
            username = clean_text(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = query_one(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            )
            if user and bcrypt.check_password_hash(user["password_hash"], password):
                session.clear()
                session["user_id"] = user["id"]
                session.permanent = True
                return redirect(url_for("index"))

            flash("Invalid username or password.", "error")

        return render_template("login.html")

    @app.route("/logout", methods=("POST",))
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/posts/new", methods=("GET", "POST"))
    @login_required
    def create_post():
        if request.method == "POST":
            title, body, errors = validate_post_form(request.form)
            if not errors:
                now = utc_now()
                post_id = execute_db(
                    """
                    INSERT INTO posts (user_id, title, body, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (g.user["id"], title, body, now, now),
                ).lastrowid
                return redirect(url_for("post_detail", post_id=post_id))

            for error in errors:
                flash(error, "error")
            return render_template("post_form.html", title=title, body=body, action="Create")

        return render_template("post_form.html", title="", body="", action="Create")

    @app.route("/posts/<int:post_id>")
    def post_detail(post_id):
        post = query_one(
            """
            SELECT posts.id, posts.title, posts.body, posts.created_at, posts.updated_at,
                   posts.user_id, users.username
            FROM posts
            JOIN users ON posts.user_id = users.id
            WHERE posts.id = ?
            """,
            (post_id,),
        )
        if post is None:
            abort(404)
        return render_template("detail.html", post=post)

    @app.route("/posts/<int:post_id>/edit", methods=("GET", "POST"))
    @login_required
    def edit_post(post_id):
        post = get_owned_post_or_404(post_id)
        if request.method == "POST":
            title, body, errors = validate_post_form(request.form)
            if not errors:
                execute_db(
                    """
                    UPDATE posts
                    SET title = ?, body = ?, updated_at = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (title, body, utc_now(), post_id, g.user["id"]),
                )
                return redirect(url_for("post_detail", post_id=post_id))

            for error in errors:
                flash(error, "error")
            return render_template("post_form.html", title=title, body=body, action="Edit")

        return render_template(
            "post_form.html",
            title=post["title"],
            body=post["body"],
            action="Edit",
        )

    @app.route("/posts/<int:post_id>/delete", methods=("POST",))
    @login_required
    def delete_post(post_id):
        get_owned_post_or_404(post_id)
        execute_db(
            "DELETE FROM posts WHERE id = ? AND user_id = ?",
            (post_id, g.user["id"]),
        )
        flash("Post deleted.", "success")
        return redirect(url_for("index"))

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            code = error.code
        else:
            app.logger.exception("Unhandled application error")
            code = 500
        return render_template("error.html", code=code), code

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app_config("DATABASE"),
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_posts_user_id ON posts (user_id);
        """
    )
    db.commit()


def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute_db(sql, params=()):
    db = get_db()
    cursor = db.execute(sql, params)
    db.commit()
    return cursor


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def get_owned_post_or_404(post_id):
    post = query_one(
        "SELECT id, user_id, title, body FROM posts WHERE id = ? AND user_id = ?",
        (post_id, g.user["id"]),
    )
    if post is None:
        abort(404)
    return post


def clean_text(value):
    value = " ".join((value or "").replace("\x00", "").split())
    return value


def clean_body(value):
    value = (value or "").replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    return value.strip()


def validate_username(username):
    if len(username) > 32:
        return "Username must be 3-32 characters and use only letters, numbers, and underscores."
    if not USERNAME_RE.fullmatch(username):
        return "Username must be 3-32 characters and use only letters, numbers, and underscores."
    return None


def validate_password(password):
    if len(password) < 12:
        return "Password must be at least 12 characters long."
    if len(password) > 128:
        return "Password is too long."
    return None


def validate_post_form(form):
    title = clean_text(form.get("title", ""))
    body = clean_body(form.get("body", ""))
    errors = []
    if not title:
        errors.append("Title is required.")
    if not body:
        errors.append("Body is required.")
    if len(title) > MAX_TITLE_LENGTH:
        errors.append("Title is too long.")
    if len(body) > MAX_BODY_LENGTH:
        errors.append("Body is too long.")
    return title, body, errors


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5026)
