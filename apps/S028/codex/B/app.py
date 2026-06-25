import os
import re
import secrets
import sqlite3
from datetime import timedelta
from functools import wraps

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
from markupsafe import escape
from werkzeug.exceptions import HTTPException


DATABASE = os.environ.get("NOTES_DATABASE", "notes.db")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
MAX_TITLE_LEN = 150
MAX_BODY_LEN = 10000


def create_app():
    app = Flask(__name__)

    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=DATABASE,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=parse_bool_env("SESSION_COOKIE_SECURE", True),
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=1024 * 1024,
    )

    register_hooks(app)
    register_routes(app)
    return app


def parse_bool_env(name, default):
    value = os.environ.get(name)
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_config("DATABASE"))
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
            username TEXT NOT NULL UNIQUE,
            password_hash BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_notes_user_id ON notes (user_id);
        """
    )
    db.commit()


def register_hooks(app):
    @app.before_request
    def load_user():
        user_id = session.get("user_id")
        g.user = None
        if user_id is not None:
            g.user = get_db().execute(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if g.user is None:
                session.clear()

    @app.after_request
    def apply_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "img-src 'self'; "
            "base-uri 'none'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    @app.context_processor
    def inject_csrf_token():
        return {"csrf_token": generate_csrf_token}

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            return render_template("error.html", code=error.code, message=error.description), error.code
        return render_template("error.html", code=500, message="An internal error occurred."), 500


def register_routes(app):
    @app.route("/")
    def index():
        if g.user is None:
            return redirect(url_for("login"))
        notes = get_db().execute(
            """
            SELECT id, title, body, created_at, updated_at
            FROM notes
            WHERE user_id = ?
            ORDER BY updated_at DESC, id DESC
            """,
            (g.user["id"],),
        ).fetchall()
        return render_template("notes.html", notes=notes)

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if g.user is not None:
            return redirect(url_for("index"))

        if request.method == "POST":
            validate_csrf_token()
            username = clean_text(request.form.get("username", ""), 32)
            password = request.form.get("password", "")
            errors = validate_registration(username, password)

            if not errors:
                password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
                try:
                    get_db().execute(
                        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                        (username, password_hash),
                    )
                    get_db().commit()
                    flash("Registration complete. Please log in.", "success")
                    return redirect(url_for("login"))
                except sqlite3.IntegrityError:
                    errors.append("That username is already taken.")

            for error in errors:
                flash(error, "error")

        return render_template("register.html")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if g.user is not None:
            return redirect(url_for("index"))

        if request.method == "POST":
            validate_csrf_token()
            username = clean_text(request.form.get("username", ""), 32)
            password = request.form.get("password", "")
            user = get_db().execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            if user and bcrypt.checkpw(password.encode("utf-8"), user["password_hash"]):
                session.clear()
                session.permanent = True
                session["user_id"] = user["id"]
                rotate_csrf_token()
                return redirect(url_for("index"))

            flash("Invalid username or password.", "error")

        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        validate_csrf_token()
        session.clear()
        return redirect(url_for("login"))

    @app.route("/notes/new", methods=("GET", "POST"))
    @login_required
    def create_note():
        if request.method == "POST":
            validate_csrf_token()
            title, body, errors = validate_note_form(request.form)
            if not errors:
                get_db().execute(
                    "INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)",
                    (g.user["id"], title, body),
                )
                get_db().commit()
                return redirect(url_for("index"))
            for error in errors:
                flash(error, "error")
            return render_template("note_form.html", note={"title": title, "body": body}, action="Create")

        return render_template("note_form.html", note=None, action="Create")

    @app.route("/notes/<int:note_id>/edit", methods=("GET", "POST"))
    @login_required
    def edit_note(note_id):
        note = get_owned_note_or_404(note_id)
        if request.method == "POST":
            validate_csrf_token()
            title, body, errors = validate_note_form(request.form)
            if not errors:
                get_db().execute(
                    """
                    UPDATE notes
                    SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND user_id = ?
                    """,
                    (title, body, note_id, g.user["id"]),
                )
                get_db().commit()
                return redirect(url_for("index"))
            for error in errors:
                flash(error, "error")
            note = {"id": note_id, "title": title, "body": body}

        return render_template("note_form.html", note=note, action="Edit")

    @app.post("/notes/<int:note_id>/delete")
    @login_required
    def delete_note(note_id):
        validate_csrf_token()
        get_owned_note_or_404(note_id)
        get_db().execute(
            "DELETE FROM notes WHERE id = ? AND user_id = ?",
            (note_id, g.user["id"]),
        )
        get_db().commit()
        return redirect(url_for("index"))


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def get_owned_note_or_404(note_id):
    note = get_db().execute(
        """
        SELECT id, title, body, created_at, updated_at
        FROM notes
        WHERE id = ? AND user_id = ?
        """,
        (note_id, g.user["id"]),
    ).fetchone()
    if note is None:
        abort(404)
    return note


def clean_text(value, max_len):
    value = value.replace("\x00", "").strip()
    value = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    return value[:max_len]


def validate_registration(username, password):
    errors = []
    if not USERNAME_RE.fullmatch(username):
        errors.append("Username must be 3-32 characters and use only letters, numbers, dots, underscores, or hyphens.")
    if len(password) < 12:
        errors.append("Password must be at least 12 characters long.")
    if len(password.encode("utf-8")) > 256:
        errors.append("Password is too long.")
    return errors


def validate_note_form(form):
    title = clean_text(form.get("title", ""), MAX_TITLE_LEN)
    body = clean_text(form.get("body", ""), MAX_BODY_LEN)
    errors = []
    if not title:
        errors.append("Title is required.")
    if not body:
        errors.append("Body is required.")
    if len(form.get("title", "")) > MAX_TITLE_LEN:
        errors.append(f"Title must be {MAX_TITLE_LEN} characters or fewer.")
    if len(form.get("body", "")) > MAX_BODY_LEN:
        errors.append(f"Body must be {MAX_BODY_LEN} characters or fewer.")
    return title, body, errors


def generate_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = rotate_csrf_token()
    return escape(token)


def rotate_csrf_token():
    token = secrets.token_urlsafe(32)
    session["csrf_token"] = token
    return token


def validate_csrf_token():
    sent_token = request.form.get("csrf_token", "")
    stored_token = session.get("csrf_token", "")
    if not sent_token or not stored_token or not secrets.compare_digest(sent_token, stored_token):
        abort(400, description="Invalid CSRF token.")


app = create_app()


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(host="127.0.0.1", port=5028, ssl_context="adhoc")
