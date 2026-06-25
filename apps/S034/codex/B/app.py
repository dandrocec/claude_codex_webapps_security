import os
import re
import secrets
import sqlite3
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
from werkzeug.exceptions import HTTPException


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(os.environ.get("DATABASE_PATH", BASE_DIR / "instance" / "reading_list.sqlite"))
STATUS_VALUES = ("to-read", "reading", "finished")
STATUS_SET = set(STATUS_VALUES)
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("FLASK_SECRET_KEY")
    if not secret_key:
        raise RuntimeError("FLASK_SECRET_KEY environment variable is required.")

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=3600,
        MAX_CONTENT_LENGTH=64 * 1024,
    )

    register_hooks(app)
    register_routes(app)
    register_errors(app)
    return app


def get_db():
    if "db" not in g:
        DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
        init_db(g.db)
    return g.db


def init_db(db):
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('to-read', 'reading', 'finished')),
            rating INTEGER CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);
        """
    )


def register_hooks(app):
    @app.before_request
    def load_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id:
            g.user = get_db().execute(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if g.user is None:
                session.clear()

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "img-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.teardown_appcontext
    def close_db(_error):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.context_processor
    def inject_csrf():
        return {"csrf_field": csrf_field}


def register_routes(app):
    @app.get("/")
    def index():
        if g.user:
            return redirect(url_for("books"))
        return render_template("index.html")

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            validate_csrf()
            username = clean_text(request.form.get("username", ""), 32)
            password = request.form.get("password", "")

            if not USERNAME_RE.fullmatch(username):
                flash("Use 3-32 letters, numbers, dots, underscores, or hyphens for the username.")
                return render_template("register.html"), 400
            if len(password) < 12 or len(password) > 128:
                flash("Password must be 12-128 characters.")
                return render_template("register.html"), 400

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
            try:
                get_db().execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, password_hash),
                )
                get_db().commit()
            except sqlite3.IntegrityError:
                flash("That username is unavailable.")
                return render_template("register.html"), 409

            flash("Account created. Please log in.")
            return redirect(url_for("login"))

        return render_template("register.html")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "POST":
            validate_csrf()
            username = clean_text(request.form.get("username", ""), 32)
            password = request.form.get("password", "")
            user = get_db().execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            if user is None or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"]):
                flash("Invalid username or password.")
                return render_template("login.html"), 401

            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("books"))

        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        validate_csrf()
        session.clear()
        flash("Logged out.")
        return redirect(url_for("index"))

    @app.get("/books")
    @login_required
    def books():
        rows = get_db().execute(
            """
            SELECT id, title, author, status, rating
            FROM books
            WHERE user_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (g.user["id"],),
        ).fetchall()
        return render_template("books.html", books=rows, statuses=STATUS_VALUES)

    @app.post("/books")
    @login_required
    def add_book():
        validate_csrf()
        title, author, status, rating = validated_book_form()
        get_db().execute(
            """
            INSERT INTO books (user_id, title, author, status, rating)
            VALUES (?, ?, ?, ?, ?)
            """,
            (g.user["id"], title, author, status, rating),
        )
        get_db().commit()
        flash("Book added.")
        return redirect(url_for("books"))

    @app.route("/books/<int:book_id>/edit", methods=("GET", "POST"))
    @login_required
    def edit_book(book_id):
        book = get_user_book_or_404(book_id)
        if request.method == "POST":
            validate_csrf()
            title, author, status, rating = validated_book_form()
            get_db().execute(
                """
                UPDATE books
                SET title = ?, author = ?, status = ?, rating = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (title, author, status, rating, book_id, g.user["id"]),
            )
            get_db().commit()
            flash("Book updated.")
            return redirect(url_for("books"))
        return render_template("edit_book.html", book=book, statuses=STATUS_VALUES)

    @app.post("/books/<int:book_id>/delete")
    @login_required
    def delete_book(book_id):
        validate_csrf()
        result = get_db().execute(
            "DELETE FROM books WHERE id = ? AND user_id = ?",
            (book_id, g.user["id"]),
        )
        get_db().commit()
        if result.rowcount == 0:
            abort(404)
        flash("Book deleted.")
        return redirect(url_for("books"))


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def get_user_book_or_404(book_id):
    book = get_db().execute(
        """
        SELECT id, title, author, status, rating
        FROM books
        WHERE id = ? AND user_id = ?
        """,
        (book_id, g.user["id"]),
    ).fetchone()
    if book is None:
        abort(404)
    return book


def validated_book_form():
    title = clean_text(request.form.get("title", ""), 120)
    author = clean_text(request.form.get("author", ""), 120)
    status = request.form.get("status", "")
    rating_raw = request.form.get("rating", "").strip()

    if not title or not author:
        abort(400)
    if status not in STATUS_SET:
        abort(400)

    rating = None
    if rating_raw:
        if not rating_raw.isdigit():
            abort(400)
        rating = int(rating_raw)
        if rating < 1 or rating > 5:
            abort(400)

    return title, author, status, rating


def clean_text(value, max_length):
    value = " ".join(value.strip().split())
    if len(value) > max_length or any(ord(char) < 32 for char in value):
        abort(400)
    return value


def get_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def csrf_field():
    token = get_csrf_token()
    return Markup(f'<input type="hidden" name="csrf_token" value="{token}">')


def validate_csrf():
    token = session.get("csrf_token")
    submitted = request.form.get("csrf_token", "")
    if not token or not secrets.compare_digest(token, submitted):
        abort(400)


def register_errors(app):
    @app.errorhandler(HTTPException)
    def handle_http_error(error):
        return render_template("error.html", code=error.code, message=error.description), error.code

    @app.errorhandler(Exception)
    def handle_unexpected_error(_error):
        return render_template("error.html", code=500, message="An unexpected error occurred."), 500


app = create_app()
