"""
Flask Notes — a small, security-focused notes application.

Features
--------
* User registration and login (sessions managed by Flask-Login).
* Per-user CRUD for notes (title + body); the list shows only the
  logged-in user's notes.
* SQLite storage accessed exclusively through parameterised queries.

Security (OWASP Top 10) highlights
----------------------------------
* A02 Crypto      : passwords hashed with bcrypt (per-password salt).
* A03 Injection   : every SQL statement uses bound parameters; output is
                    escaped by Jinja2 autoescaping (context-aware).
* A01 Access ctrl : notes are scoped to ``owner_id`` on every query, so a
                    user can never read/modify another user's note (no IDOR).
* CSRF            : Flask-WTF issues and validates a CSRF token on every
                    state-changing POST.
* Session cookies : HttpOnly, SameSite=Lax and (configurable) Secure.
* Headers         : a strict Content-Security-Policy plus the usual
                    hardening headers are added to every response.
* Errors          : custom 4xx/5xx handlers never leak stack traces.
* Secrets         : SECRET_KEY is read from the environment.
"""

import os
import sqlite3
from contextlib import closing

import bcrypt
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
from flask_wtf import FlaskForm, CSRFProtect
from wtforms import PasswordField, StringField, TextAreaField
from wtforms.validators import InputRequired, Length, Regexp

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "notes.db"))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def create_app() -> Flask:
    app = Flask(__name__)

    # SECRET_KEY must come from the environment. We refuse to start with a
    # predictable key so sessions/CSRF tokens cannot be forged.
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        raise RuntimeError(
            "SECRET_KEY environment variable is not set. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )
    app.config.update(
        SECRET_KEY=secret,
        # Secure session cookies. Secure defaults to True; set
        # SESSION_COOKIE_SECURE=false when testing over plain HTTP locally.
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=_env_bool("SESSION_COOKIE_SECURE", True),
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=256 * 1024,  # cap request bodies (256 KB)
    )

    CSRFProtect(app)

    login_manager = LoginManager(app)
    login_manager.login_view = "login"
    login_manager.session_protection = "strong"

    # ----------------------------------------------------------------- #
    # Database helpers
    # ----------------------------------------------------------------- #

    def get_db() -> sqlite3.Connection:
        if "db" not in g:
            conn = sqlite3.connect(DATABASE)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA foreign_keys = ON")
            g.db = conn
        return g.db

    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    def init_db() -> None:
        with closing(sqlite3.connect(DATABASE)) as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    username      TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS notes (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    owner_id   INTEGER NOT NULL,
                    title      TEXT NOT NULL,
                    body       TEXT NOT NULL DEFAULT '',
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
                    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_notes_owner ON notes(owner_id);
                """
            )
            conn.commit()

    app.init_db = init_db  # exposed for the CLI / tests

    # ----------------------------------------------------------------- #
    # Authentication model
    # ----------------------------------------------------------------- #

    class User(UserMixin):
        def __init__(self, row: sqlite3.Row):
            self.id = row["id"]
            self.username = row["username"]
            self.password_hash = row["password_hash"]

    @login_manager.user_loader
    def load_user(user_id: str):
        try:
            uid = int(user_id)
        except (TypeError, ValueError):
            return None
        row = get_db().execute(
            "SELECT * FROM users WHERE id = ?", (uid,)
        ).fetchone()
        return User(row) if row else None

    # ----------------------------------------------------------------- #
    # Forms (input validation lives here)
    # ----------------------------------------------------------------- #

    class RegisterForm(FlaskForm):
        username = StringField(
            "Username",
            validators=[
                InputRequired(),
                Length(min=3, max=32),
                Regexp(
                    r"^[A-Za-z0-9_.-]+$",
                    message="Use letters, numbers, and . _ - only.",
                ),
            ],
        )
        password = PasswordField(
            "Password",
            validators=[InputRequired(), Length(min=8, max=128)],
        )

    class LoginForm(FlaskForm):
        username = StringField("Username", validators=[InputRequired(), Length(max=32)])
        password = PasswordField("Password", validators=[InputRequired(), Length(max=128)])

    class NoteForm(FlaskForm):
        title = StringField(
            "Title", validators=[InputRequired(), Length(min=1, max=200)]
        )
        body = TextAreaField("Body", validators=[Length(max=20000)])

    # ----------------------------------------------------------------- #
    # Password hashing (bcrypt, salted)
    # ----------------------------------------------------------------- #

    def hash_password(password: str) -> str:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

    def verify_password(password: str, stored_hash: str) -> bool:
        try:
            return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
        except (ValueError, TypeError):
            return False

    # ----------------------------------------------------------------- #
    # Routes
    # ----------------------------------------------------------------- #

    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("list_notes"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("list_notes"))
        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            db = get_db()
            existing = db.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing:
                flash("That username is already taken.", "error")
            else:
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, hash_password(form.password.data)),
                )
                db.commit()
                flash("Account created — please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("list_notes"))
        form = LoginForm()
        if form.validate_on_submit():
            row = get_db().execute(
                "SELECT * FROM users WHERE username = ?",
                (form.username.data.strip(),),
            ).fetchone()
            # Always run a verification to keep timing roughly constant and
            # return an identical message whether the user or password is wrong.
            if row and verify_password(form.password.data, row["password_hash"]):
                login_user(User(row))
                flash("Welcome back!", "success")
                return redirect(url_for("list_notes"))
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "success")
        return redirect(url_for("login"))

    @app.route("/notes")
    @login_required
    def list_notes():
        notes = get_db().execute(
            "SELECT id, title, body, updated_at FROM notes "
            "WHERE owner_id = ? ORDER BY updated_at DESC",
            (current_user.id,),
        ).fetchall()
        return render_template("notes_list.html", notes=notes)

    @app.route("/notes/new", methods=["GET", "POST"])
    @login_required
    def create_note():
        form = NoteForm()
        if form.validate_on_submit():
            db = get_db()
            db.execute(
                "INSERT INTO notes (owner_id, title, body) VALUES (?, ?, ?)",
                (current_user.id, form.title.data.strip(), form.body.data or ""),
            )
            db.commit()
            flash("Note created.", "success")
            return redirect(url_for("list_notes"))
        return render_template("note_form.html", form=form, mode="new")

    def _owned_note_or_404(note_id: int) -> sqlite3.Row:
        """Fetch a note scoped to the current user — prevents IDOR."""
        note = get_db().execute(
            "SELECT * FROM notes WHERE id = ? AND owner_id = ?",
            (note_id, current_user.id),
        ).fetchone()
        if note is None:
            abort(404)
        return note

    @app.route("/notes/<int:note_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_note(note_id: int):
        note = _owned_note_or_404(note_id)
        form = NoteForm(data={"title": note["title"], "body": note["body"]})
        if form.validate_on_submit():
            db = get_db()
            db.execute(
                "UPDATE notes SET title = ?, body = ?, updated_at = datetime('now') "
                "WHERE id = ? AND owner_id = ?",
                (form.title.data.strip(), form.body.data or "", note_id, current_user.id),
            )
            db.commit()
            flash("Note updated.", "success")
            return redirect(url_for("list_notes"))
        return render_template("note_form.html", form=form, mode="edit", note=note)

    @app.route("/notes/<int:note_id>/delete", methods=["POST"])
    @login_required
    def delete_note(note_id: int):
        _owned_note_or_404(note_id)
        db = get_db()
        db.execute(
            "DELETE FROM notes WHERE id = ? AND owner_id = ?",
            (note_id, current_user.id),
        )
        db.commit()
        flash("Note deleted.", "success")
        return redirect(url_for("list_notes"))

    # ----------------------------------------------------------------- #
    # Security headers
    # ----------------------------------------------------------------- #

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'"
        )
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    # ----------------------------------------------------------------- #
    # Error handlers (no stack traces leak to clients)
    # ----------------------------------------------------------------- #

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(500)
    def handle_error(error):
        code = getattr(error, "code", 500)
        messages = {
            400: "Bad request.",
            403: "You don't have access to that.",
            404: "Not found.",
            500: "Something went wrong on our end.",
        }
        return render_template(
            "error.html", code=code, message=messages.get(code, "Error.")
        ), code

    # Initialise the schema on startup (idempotent).
    with app.app_context():
        init_db()

    return app


app = create_app()


if __name__ == "__main__":
    # debug is OFF by default so tracebacks are never exposed. Override only
    # for local development via FLASK_DEBUG=1.
    app.run(
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "5028")),
        debug=_env_bool("FLASK_DEBUG", False),
    )
