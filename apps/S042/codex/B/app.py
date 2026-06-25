import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import bcrypt
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
from markupsafe import Markup


BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "news.sqlite3"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def create_app():
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") == "1",
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=1024 * 1024,
    )

    @app.before_request
    def load_user_and_protect_forms():
        g.user = None
        user_id = session.get("user_id")
        if user_id:
            g.user = query_one(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            )

        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            token = session.get("csrf_token")
            submitted = request.form.get("csrf_token", "")
            if not token or not secrets.compare_digest(token, submitted):
                abort(400)

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Cache-Control"] = "no-store" if g.get("user") else "no-cache"
        return response

    @app.context_processor
    def inject_helpers():
        return {"csrf_token": csrf_token, "nl2br": nl2br}

    @app.route("/")
    def index():
        articles = query_all(
            """
            SELECT articles.id, articles.title, articles.body, articles.created_at,
                   users.username AS author_name,
                   (SELECT COUNT(*) FROM comments WHERE article_id = articles.id) AS comment_count
            FROM articles
            JOIN users ON users.id = articles.author_id
            ORDER BY articles.created_at DESC
            """
        )
        return render_template("index.html", articles=articles)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = clean_text(request.form.get("username"), 32)
            password = request.form.get("password", "")

            if not USERNAME_RE.fullmatch(username):
                flash("Usernames must be 3-32 characters and use letters, numbers, dots, dashes, or underscores.")
                return render_template("register.html"), 400
            if len(password) < 12 or len(password) > 256:
                flash("Passwords must be between 12 and 256 characters.")
                return render_template("register.html"), 400

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            try:
                execute(
                    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, password_hash, utc_now()),
                )
            except sqlite3.IntegrityError:
                flash("That username is already taken.")
                return render_template("register.html"), 409

            user = query_one("SELECT id FROM users WHERE username = ?", (username,))
            session.clear()
            session["user_id"] = user["id"]
            csrf_token()
            return redirect(url_for("index"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_text(request.form.get("username"), 32)
            password = request.form.get("password", "")
            user = query_one("SELECT id, password_hash FROM users WHERE username = ?", (username,))

            if not user or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
                flash("Invalid username or password.")
                return render_template("login.html"), 401

            session.clear()
            session["user_id"] = user["id"]
            csrf_token()
            return redirect(url_for("index"))

        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/articles/new", methods=["GET", "POST"])
    @login_required
    def new_article():
        if request.method == "POST":
            title = clean_text(request.form.get("title"), 160)
            body = clean_text(request.form.get("body"), 20000)
            errors = article_errors(title, body)
            if errors:
                for error in errors:
                    flash(error)
                return render_template("article_form.html", article=None), 400

            execute(
                "INSERT INTO articles (author_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
                (g.user["id"], title, body, utc_now(), utc_now()),
            )
            article = query_one(
                "SELECT id FROM articles WHERE author_id = ? ORDER BY id DESC LIMIT 1",
                (g.user["id"],),
            )
            return redirect(url_for("article_detail", article_id=article["id"]))

        return render_template("article_form.html", article=None)

    @app.route("/articles/<int:article_id>")
    def article_detail(article_id):
        article = get_article(article_id)
        comments = query_all(
            """
            SELECT id, commenter_name, body, created_at
            FROM comments
            WHERE article_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (article_id,),
        )
        return render_template("article_detail.html", article=article, comments=comments)

    @app.route("/articles/<int:article_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_article(article_id):
        article = get_article(article_id)
        require_owner(article)

        if request.method == "POST":
            title = clean_text(request.form.get("title"), 160)
            body = clean_text(request.form.get("body"), 20000)
            errors = article_errors(title, body)
            if errors:
                for error in errors:
                    flash(error)
                return render_template("article_form.html", article=article), 400

            execute(
                "UPDATE articles SET title = ?, body = ?, updated_at = ? WHERE id = ? AND author_id = ?",
                (title, body, utc_now(), article_id, g.user["id"]),
            )
            return redirect(url_for("article_detail", article_id=article_id))

        return render_template("article_form.html", article=article)

    @app.post("/articles/<int:article_id>/delete")
    @login_required
    def delete_article(article_id):
        article = get_article(article_id)
        require_owner(article)
        execute("DELETE FROM articles WHERE id = ? AND author_id = ?", (article_id, g.user["id"]))
        return redirect(url_for("index"))

    @app.post("/articles/<int:article_id>/comments")
    def add_comment(article_id):
        get_article(article_id)
        commenter_name = clean_text(request.form.get("commenter_name"), 80)
        body = clean_text(request.form.get("body"), 5000)

        if len(commenter_name) < 2 or len(body) < 1:
            flash("Comments require a name and message.")
            return redirect(url_for("article_detail", article_id=article_id))

        execute(
            "INSERT INTO comments (article_id, commenter_name, body, created_at) VALUES (?, ?, ?, ?)",
            (article_id, commenter_name, body, utc_now()),
        )
        return redirect(url_for("article_detail", article_id=article_id))

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", title="Bad request", message="The request could not be processed."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", title="Forbidden", message="You do not have access to that resource."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", title="Not found", message="The requested page was not found."), 404

    @app.errorhandler(413)
    def too_large(_error):
        return render_template("error.html", title="Too large", message="The submitted data is too large."), 413

    @app.errorhandler(500)
    def internal_error(_error):
        return render_template("error.html", title="Server error", message="An unexpected error occurred."), 500

    init_db()
    app.teardown_appcontext(close_db)
    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def execute(sql, params=()):
    db = get_db()
    db.execute(sql, params)
    db.commit()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def init_db():
    DATABASE.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DATABASE)
    try:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS articles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id INTEGER NOT NULL,
                commenter_name TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
            );
            """
        )
        db.commit()
    finally:
        db.close()


def csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def clean_text(value, max_length):
    value = (value or "").strip()
    value = "".join(ch for ch in value if ch == "\n" or ch == "\t" or not ch.isspace() or ch == " ")
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    return value[:max_length]


def article_errors(title, body):
    errors = []
    if len(title) < 5:
        errors.append("Article titles must be at least 5 characters.")
    if len(body) < 20:
        errors.append("Article bodies must be at least 20 characters.")
    return errors


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def nl2br(value):
    escaped = Markup.escape(value)
    return Markup("<br>").join(escaped.splitlines())


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login", next=request.path))
        return view(**kwargs)

    return wrapped_view


def get_article(article_id):
    article = query_one(
        """
        SELECT articles.id, articles.author_id, articles.title, articles.body,
               articles.created_at, articles.updated_at, users.username AS author_name
        FROM articles
        JOIN users ON users.id = articles.author_id
        WHERE articles.id = ?
        """,
        (article_id,),
    )
    if article is None:
        abort(404)
    return article


def require_owner(article):
    if article["author_id"] != g.user["id"]:
        abort(403)


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5042)
