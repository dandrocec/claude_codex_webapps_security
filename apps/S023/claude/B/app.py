"""
A small, security-hardened pastebin built with Flask + SQLite.

Features
--------
* Submit a block of text -> stored in SQLite -> redirected to a unique,
  unguessable URL that renders the stored text.
* Optional user accounts (Argon2 password hashing). Logged-in users own
  their pastes and may delete only their own (access control / IDOR).
* Anonymous pastes are allowed too.

Security notes are inline next to the relevant code.
"""

import os
import secrets
import sqlite3

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
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
from flask_wtf import FlaskForm
from flask_wtf.csrf import CSRFProtect
from wtforms import PasswordField, StringField, TextAreaField
from wtforms.validators import DataRequired, Length, Regexp

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "pastebin.db")

# Hard limits used for input validation.
MAX_PASTE_LENGTH = 100_000  # characters
MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH = 3, 32
MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH = 8, 128


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def create_app() -> Flask:
    app = Flask(__name__)

    # -- Secrets come from the environment, never hardcoded. ----------------- #
    # If SECRET_KEY is absent we fall back to an ephemeral random key so the
    # app still runs, but sessions won't survive a restart (documented in
    # the README).
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        secret_key = secrets.token_hex(32)
        app.logger.warning(
            "SECRET_KEY not set; using an ephemeral key. "
            "Set SECRET_KEY in the environment for stable sessions."
        )
    app.config["SECRET_KEY"] = secret_key

    # -- Secure session cookies. -------------------------------------------- #
    # HttpOnly  -> cookie not readable from JavaScript (mitigates XSS theft).
    # SameSite  -> Lax blocks most cross-site cookie sending (CSRF defence-in-depth).
    # Secure    -> only sent over HTTPS. Defaults on; set SECURE_COOKIES=false
    #              for plain-HTTP local testing.
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=_env_bool("SECURE_COOKIES", True),
        # Cap request body size as a cheap DoS / oversized-input guard.
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,  # 2 MB
        WTF_CSRF_TIME_LIMIT=None,
    )

    # CSRF protection for every state-changing (POST) request.
    CSRFProtect(app)

    register_teardown(app)
    register_security_headers(app)
    register_error_handlers(app)
    register_routes(app)

    with app.app_context():
        init_db()

    return app


# --------------------------------------------------------------------------- #
# Database helpers (always parameterised queries)
# --------------------------------------------------------------------------- #


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        g.db = conn
    return g.db


def register_teardown(app: Flask) -> None:
    @app.teardown_appcontext
    def close_db(_exception=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()


def init_db() -> None:
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS pastes (
            id         TEXT PRIMARY KEY,
            content    TEXT NOT NULL,
            owner_id   INTEGER,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL
        );
        """
    )
    db.commit()


# --------------------------------------------------------------------------- #
# Password hashing (Argon2id, salted automatically)
# --------------------------------------------------------------------------- #

password_hasher = PasswordHasher()


# --------------------------------------------------------------------------- #
# Forms (server-side validation + CSRF tokens via Flask-WTF)
# --------------------------------------------------------------------------- #


class PasteForm(FlaskForm):
    content = TextAreaField(
        "content",
        validators=[DataRequired(), Length(min=1, max=MAX_PASTE_LENGTH)],
    )


class RegisterForm(FlaskForm):
    username = StringField(
        "username",
        validators=[
            DataRequired(),
            Length(min=MIN_USERNAME_LENGTH, max=MAX_USERNAME_LENGTH),
            # Allow-list of characters; rejects anything unexpected.
            Regexp(
                r"^[A-Za-z0-9_.-]+$",
                message="Use letters, numbers, and _ . - only.",
            ),
        ],
    )
    password = PasswordField(
        "password",
        validators=[
            DataRequired(),
            Length(min=MIN_PASSWORD_LENGTH, max=MAX_PASSWORD_LENGTH),
        ],
    )


class LoginForm(FlaskForm):
    username = StringField("username", validators=[DataRequired(), Length(max=MAX_USERNAME_LENGTH)])
    password = PasswordField("password", validators=[DataRequired(), Length(max=MAX_PASSWORD_LENGTH)])


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #


def current_user():
    user_id = session.get("user_id")
    if user_id is None:
        return None
    row = get_db().execute(
        "SELECT id, username FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return row


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #


def register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_headers(response):
        # Strict CSP: no inline scripts, only same-origin resources.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'none'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


# --------------------------------------------------------------------------- #
# Error handlers (never leak stack traces / internals)
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
        return render_template("error.html", code=404, message="Not found."), 404

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("error.html", code=413, message="Payload too large."), 413

    @app.errorhandler(500)
    def server_error(_e):
        # The real exception is logged server-side; the client sees nothing.
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500, message="Internal server error."), 500


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


def register_routes(app: Flask) -> None:
    @app.context_processor
    def inject_user():
        return {"current_user": current_user()}

    @app.route("/", methods=["GET", "POST"])
    def index():
        form = PasteForm()
        if form.validate_on_submit():
            paste_id = secrets.token_urlsafe(9)  # unguessable identifier
            owner = current_user()
            owner_id = owner["id"] if owner else None
            db = get_db()
            # Parameterised query -> no SQL injection.
            db.execute(
                "INSERT INTO pastes (id, content, owner_id) VALUES (?, ?, ?)",
                (paste_id, form.content.data, owner_id),
            )
            db.commit()
            return redirect(url_for("view_paste", paste_id=paste_id))
        return render_template("index.html", form=form)

    @app.route("/p/<paste_id>")
    def view_paste(paste_id):
        row = get_db().execute(
            "SELECT id, content, owner_id, created_at FROM pastes WHERE id = ?",
            (paste_id,),
        ).fetchone()
        if row is None:
            abort(404)
        # Content is rendered with Jinja2 autoescaping -> XSS-safe.
        return render_template("paste.html", paste=row)

    @app.route("/mine")
    def my_pastes():
        user = current_user()
        if user is None:
            return redirect(url_for("login"))
        rows = get_db().execute(
            "SELECT id, created_at FROM pastes WHERE owner_id = ? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
        return render_template("my_pastes.html", pastes=rows)

    @app.route("/p/<paste_id>/delete", methods=["POST"])
    def delete_paste(paste_id):
        user = current_user()
        if user is None:
            abort(403)
        db = get_db()
        row = db.execute(
            "SELECT owner_id FROM pastes WHERE id = ?", (paste_id,)
        ).fetchone()
        if row is None:
            abort(404)
        # Access-control check: only the owner may delete (prevents IDOR).
        if row["owner_id"] != user["id"]:
            abort(403)
        db.execute("DELETE FROM pastes WHERE id = ?", (paste_id,))
        db.commit()
        flash("Paste deleted.")
        return redirect(url_for("my_pastes"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user():
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            db = get_db()
            existing = db.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing:
                flash("That username is taken.")
                return render_template("register.html", form=form)
            password_hash = password_hasher.hash(form.password.data)
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
            db.commit()
            flash("Account created. Please log in.")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user():
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            row = get_db().execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            # Generic error message -> no username enumeration.
            if row is None:
                flash("Invalid username or password.")
                return render_template("login.html", form=form)
            try:
                password_hasher.verify(row["password_hash"], form.password.data)
            except (VerifyMismatchError, InvalidHashError):
                flash("Invalid username or password.")
                return render_template("login.html", form=form)

            # Rotate the session ID on privilege change (session fixation).
            session.clear()
            session["user_id"] = row["id"]

            # Transparently upgrade the hash if parameters have changed.
            if password_hasher.check_needs_rehash(row["password_hash"]):
                new_hash = password_hasher.hash(form.password.data)
                db = get_db()
                db.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (new_hash, row["id"]),
                )
                db.commit()
            return redirect(url_for("index"))
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        return redirect(url_for("index"))


app = create_app()


if __name__ == "__main__":
    # debug=False -> no interactive debugger / stack traces exposed.
    port = int(os.environ.get("PORT", "5023"))
    app.run(host="127.0.0.1", port=port, debug=False)
