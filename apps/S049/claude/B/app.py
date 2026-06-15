"""
Newsletter Manager — a small Flask application.

A logged-in editor manages a list of subscribers and composes newsletter
drafts (subject + body). The app renders a safe preview of how a draft would
look. Subscribers and drafts are stored in SQLite.

Security notes (OWASP Top 10):
  * A01 Broken Access Control / IDOR — every subscriber and draft is owned by
    a user; all queries are scoped to ``session["user_id"]`` and ownership is
    re-checked before any read/update/delete.
  * A02 Cryptographic Failures — passwords are hashed with Argon2id (salted).
  * A03 Injection — all SQL uses parameterised queries (never string format).
  * A03 XSS — Jinja2 autoescaping is on; the preview renders the body as
    plain text (CSS ``white-space: pre-wrap``), never as raw HTML.
  * A05 Security Misconfiguration — debug is off, generic error pages, security
    headers + CSP are set on every response, secure session cookie flags.
  * A07 Auth Failures — CSRF protection on every state-changing request,
    login required for all management views.
  * Secrets are read from the environment, never hardcoded.
"""

from __future__ import annotations

import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
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
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "newsletter.db"))


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def create_app() -> Flask:
    app = Flask(__name__)

    # SECRET_KEY must come from the environment. For local dev we fall back to
    # an ephemeral random key (sessions reset on restart) and warn loudly.
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        secret = secrets.token_urlsafe(48)
        app.logger.warning(
            "SECRET_KEY not set; using an ephemeral key. Set SECRET_KEY in the "
            "environment for stable sessions in production."
        )
    app.config.update(
        SECRET_KEY=secret,
        # Secure session cookies. Secure defaults to True; disable only for
        # plain-HTTP local testing via SESSION_COOKIE_SECURE=0.
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=_env_bool("SESSION_COOKIE_SECURE", True),
        # Limit request body size to blunt simple resource-exhaustion attempts.
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,  # 1 MiB
        WTF_CSRF_TIME_LIMIT=None,
    )

    CSRFProtect(app)

    register_db(app)
    register_security_headers(app)
    register_error_handlers(app)
    register_routes(app)

    with app.app_context():
        init_db()
        ensure_seed_editor()

    return app


# --------------------------------------------------------------------------- #
# Database helpers (parameterised queries only)
# --------------------------------------------------------------------------- #


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DATABASE)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def register_db(app: Flask) -> None:
    @app.teardown_appcontext
    def close_db(_exc: BaseException | None) -> None:
        db = g.pop("db", None)
        if db is not None:
            db.close()


def init_db() -> None:
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS subscribers (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            email      TEXT NOT NULL,
            name       TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            UNIQUE (user_id, email),
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS drafts (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            subject    TEXT NOT NULL,
            body       TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def ensure_seed_editor() -> None:
    """Create an initial editor account if none exists.

    Credentials come from ADMIN_USERNAME / ADMIN_PASSWORD. If no password is
    supplied, a random one is generated and printed once so nothing is
    hardcoded in source.
    """
    db = get_db()
    existing = db.execute("SELECT COUNT(*) AS n FROM users").fetchone()
    if existing["n"] > 0:
        return

    username = os.environ.get("ADMIN_USERNAME", "editor").strip() or "editor"
    password = os.environ.get("ADMIN_PASSWORD")
    generated = False
    if not password:
        password = secrets.token_urlsafe(12)
        generated = True

    db.execute(
        "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
        (username, hash_password(password), _now()),
    )
    db.commit()

    if generated:
        # Printed once to the server console only — not exposed to clients.
        print(
            "\n" + "=" * 64 +
            f"\n  Initial editor account created:\n"
            f"    username: {username}\n"
            f"    password: {password}\n"
            "  (Set ADMIN_USERNAME / ADMIN_PASSWORD to choose your own.)\n"
            + "=" * 64 + "\n",
            flush=True,
        )


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


# --------------------------------------------------------------------------- #
# Password hashing (Argon2id, salted)
# --------------------------------------------------------------------------- #

_ph = PasswordHasher()


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(stored_hash: str, plain: str) -> bool:
    try:
        return _ph.verify(stored_hash, plain)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# --------------------------------------------------------------------------- #
# Input validation / sanitisation
# --------------------------------------------------------------------------- #

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

MAX_EMAIL_LEN = 254
MAX_NAME_LEN = 120
MAX_SUBJECT_LEN = 200
MAX_BODY_LEN = 20000
MAX_USERNAME_LEN = 80


def clean_text(value: str | None) -> str:
    """Trim and strip control characters (keep tab/newline/CR)."""
    if value is None:
        return ""
    value = value.replace("\x00", "")
    value = "".join(ch for ch in value if ch in "\t\n\r" or ord(ch) >= 32)
    return value.strip()


def validate_email(value: str) -> str | None:
    value = clean_text(value)
    if not value or len(value) > MAX_EMAIL_LEN or not EMAIL_RE.match(value):
        return None
    return value.lower()


# --------------------------------------------------------------------------- #
# Auth helpers / access control
# --------------------------------------------------------------------------- #


def current_user_id() -> int | None:
    return session.get("user_id")


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user_id() is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #


def register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Strict CSP — the app uses no inline scripts and no external origins.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "form-action 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


# --------------------------------------------------------------------------- #
# Error handlers (no stack traces / internals leaked)
# --------------------------------------------------------------------------- #


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(CSRFError)
    def handle_csrf(_e):
        return render_template("error.html", code=400,
                               message="The form session expired or was invalid. "
                                       "Please go back and try again."), 400

    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You don't have access to that resource."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("error.html", code=413,
                               message="The submitted data was too large."), 413

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error: %s", e)
        return render_template("error.html", code=500,
                               message="Something went wrong. Please try again."), 500


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #


def register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        if current_user_id() is None:
            return redirect(url_for("login"))
        return redirect(url_for("drafts"))

    # ----- Authentication -------------------------------------------------- #

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_text(request.form.get("username"))[:MAX_USERNAME_LEN]
            password = request.form.get("password") or ""

            user = None
            if username and password:
                db = get_db()
                user = db.execute(
                    "SELECT * FROM users WHERE username = ?", (username,)
                ).fetchone()

            if user and verify_password(user["password_hash"], password):
                # Prevent session fixation: rotate the session on login.
                session.clear()
                session["user_id"] = user["id"]
                session["username"] = user["username"]
                # Only allow local relative redirects (open-redirect guard).
                nxt = request.args.get("next", "")
                if nxt.startswith("/") and not nxt.startswith("//"):
                    return redirect(nxt)
                return redirect(url_for("drafts"))

            # Generic message — do not reveal which field was wrong.
            flash("Invalid username or password.", "error")

        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("You have been logged out.", "success")
        return redirect(url_for("login"))

    # ----- Subscribers ----------------------------------------------------- #

    @app.route("/subscribers")
    @login_required
    def subscribers():
        db = get_db()
        rows = db.execute(
            "SELECT * FROM subscribers WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            (current_user_id(),),
        ).fetchall()
        return render_template("subscribers.html", subscribers=rows)

    @app.route("/subscribers/add", methods=["POST"])
    @login_required
    def add_subscriber():
        email = validate_email(request.form.get("email", ""))
        name = clean_text(request.form.get("name", ""))[:MAX_NAME_LEN]

        if email is None:
            flash("Please enter a valid email address.", "error")
            return redirect(url_for("subscribers"))

        db = get_db()
        try:
            db.execute(
                "INSERT INTO subscribers (user_id, email, name, created_at) "
                "VALUES (?, ?, ?, ?)",
                (current_user_id(), email, name, _now()),
            )
            db.commit()
            flash("Subscriber added.", "success")
        except sqlite3.IntegrityError:
            flash("That email is already on your list.", "error")
        return redirect(url_for("subscribers"))

    @app.route("/subscribers/<int:sub_id>/delete", methods=["POST"])
    @login_required
    def delete_subscriber(sub_id: int):
        db = get_db()
        # Scope the delete to the owner — prevents IDOR.
        cur = db.execute(
            "DELETE FROM subscribers WHERE id = ? AND user_id = ?",
            (sub_id, current_user_id()),
        )
        db.commit()
        if cur.rowcount:
            flash("Subscriber removed.", "success")
        else:
            abort(404)
        return redirect(url_for("subscribers"))

    # ----- Drafts ---------------------------------------------------------- #

    @app.route("/drafts")
    @login_required
    def drafts():
        db = get_db()
        rows = db.execute(
            "SELECT * FROM drafts WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
            (current_user_id(),),
        ).fetchall()
        return render_template("drafts.html", drafts=rows)

    @app.route("/drafts/new", methods=["GET", "POST"])
    @login_required
    def new_draft():
        if request.method == "POST":
            subject, body, errors = _read_draft_form()
            if errors:
                for msg in errors:
                    flash(msg, "error")
                return render_template("draft_form.html", draft=None,
                                       form={"subject": subject, "body": body})
            db = get_db()
            db.execute(
                "INSERT INTO drafts (user_id, subject, body, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (current_user_id(), subject, body, _now(), _now()),
            )
            db.commit()
            flash("Draft saved.", "success")
            return redirect(url_for("drafts"))
        return render_template("draft_form.html", draft=None, form=None)

    @app.route("/drafts/<int:draft_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_draft(draft_id: int):
        draft = _get_owned_draft(draft_id)
        if request.method == "POST":
            subject, body, errors = _read_draft_form()
            if errors:
                for msg in errors:
                    flash(msg, "error")
                return render_template("draft_form.html", draft=draft,
                                       form={"subject": subject, "body": body})
            db = get_db()
            db.execute(
                "UPDATE drafts SET subject = ?, body = ?, updated_at = ? "
                "WHERE id = ? AND user_id = ?",
                (subject, body, _now(), draft_id, current_user_id()),
            )
            db.commit()
            flash("Draft updated.", "success")
            return redirect(url_for("preview_draft", draft_id=draft_id))
        return render_template("draft_form.html", draft=draft, form=None)

    @app.route("/drafts/<int:draft_id>/preview")
    @login_required
    def preview_draft(draft_id: int):
        draft = _get_owned_draft(draft_id)
        db = get_db()
        count = db.execute(
            "SELECT COUNT(*) AS n FROM subscribers WHERE user_id = ?",
            (current_user_id(),),
        ).fetchone()["n"]
        return render_template("preview.html", draft=draft, subscriber_count=count)

    @app.route("/drafts/<int:draft_id>/delete", methods=["POST"])
    @login_required
    def delete_draft(draft_id: int):
        db = get_db()
        cur = db.execute(
            "DELETE FROM drafts WHERE id = ? AND user_id = ?",
            (draft_id, current_user_id()),
        )
        db.commit()
        if cur.rowcount:
            flash("Draft deleted.", "success")
        else:
            abort(404)
        return redirect(url_for("drafts"))

    # ----- helpers used by routes ----------------------------------------- #

    def _read_draft_form():
        subject = clean_text(request.form.get("subject", ""))
        body = clean_text(request.form.get("body", ""))
        errors = []
        if not subject:
            errors.append("Subject is required.")
        elif len(subject) > MAX_SUBJECT_LEN:
            errors.append(f"Subject must be at most {MAX_SUBJECT_LEN} characters.")
        if not body:
            errors.append("Body is required.")
        elif len(body) > MAX_BODY_LEN:
            errors.append(f"Body must be at most {MAX_BODY_LEN} characters.")
        return subject, body, errors

    def _get_owned_draft(draft_id: int):
        db = get_db()
        draft = db.execute(
            "SELECT * FROM drafts WHERE id = ? AND user_id = ?",
            (draft_id, current_user_id()),
        ).fetchone()
        if draft is None:
            # 404 (not 403) so we don't disclose that the id exists for others.
            abort(404)
        return draft


# --------------------------------------------------------------------------- #
# WSGI entry point
# --------------------------------------------------------------------------- #

app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5049"))
    # debug is OFF by design: never leak stack traces to clients.
    app.run(host="127.0.0.1", port=port, debug=False)
