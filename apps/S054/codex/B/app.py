import os
import re
import secrets
import sqlite3
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from html import escape

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
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
from werkzeug.exceptions import HTTPException


DATABASE_PATH = os.environ.get("DATABASE_PATH", "time_tracker.sqlite3")
PASSWORD_HASHER = PasswordHasher()
EMAIL_RE = re.compile(r"^[^@\s]{3,254}@[^@\s]{2,253}\.[^@\s]{2,63}$")


def create_app():
    app = Flask(__name__)

    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        not in {"0", "false", "no"},
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        MAX_CONTENT_LENGTH=64 * 1024,
    )

    @app.before_request
    def prepare_request():
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
        init_db(g.db)
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            validate_csrf()

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; form-action 'self'; "
            "frame-ancestors 'none'; object-src 'none'; style-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.teardown_request
    def close_db(_exc):
        db = getattr(g, "db", None)
        if db is not None:
            db.close()

    @app.context_processor
    def inject_csrf():
        return {"csrf_token": get_csrf_token}

    @app.errorhandler(Exception)
    def handle_error(exc):
        if isinstance(exc, HTTPException):
            return render_template("error.html", code=exc.code, message=exc.description), exc.code
        app.logger.exception("Unhandled application error")
        return render_template("error.html", code=500, message="An unexpected error occurred."), 500

    @app.route("/")
    def index():
        if current_user_id():
            return redirect(url_for("dashboard"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            email = clean_text(request.form.get("email", ""), 254).lower()
            password = request.form.get("password", "")
            if not EMAIL_RE.fullmatch(email):
                flash("Enter a valid email address.")
            elif len(password) < 12:
                flash("Password must be at least 12 characters.")
            else:
                try:
                    g.db.execute(
                        "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                        (email, PASSWORD_HASHER.hash(password)),
                    )
                    g.db.commit()
                    flash("Account created. Please sign in.")
                    return redirect(url_for("login"))
                except sqlite3.IntegrityError:
                    flash("An account with that email already exists.")
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = clean_text(request.form.get("email", ""), 254).lower()
            password = request.form.get("password", "")
            user = g.db.execute(
                "SELECT id, password_hash FROM users WHERE email = ?", (email,)
            ).fetchone()
            if user and verify_password(user["password_hash"], password):
                session.clear()
                session.permanent = True
                session["user_id"] = user["id"]
                session["csrf_token"] = secrets.token_urlsafe(32)
                return redirect(url_for("dashboard"))
            flash("Invalid email or password.")
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("login"))

    @app.route("/dashboard", methods=["GET", "POST"])
    @login_required
    def dashboard():
        selected_week = parse_week(request.args.get("week"))
        if request.method == "POST":
            entry, errors = read_entry_form()
            if errors:
                for error in errors:
                    flash(error)
            else:
                g.db.execute(
                    """
                    INSERT INTO entries (user_id, project, entry_date, hours, note)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        current_user_id(),
                        entry["project"],
                        entry["entry_date"],
                        str(entry["hours"]),
                        entry["note"],
                    ),
                )
                g.db.commit()
                return redirect(url_for("dashboard", week=entry["entry_date"][:10]))

        week_start = selected_week - timedelta(days=selected_week.weekday())
        week_end = week_start + timedelta(days=6)
        entries = g.db.execute(
            """
            SELECT id, project, entry_date, hours, note
            FROM entries
            WHERE user_id = ? AND entry_date BETWEEN ? AND ?
            ORDER BY entry_date DESC, id DESC
            """,
            (current_user_id(), week_start.isoformat(), week_end.isoformat()),
        ).fetchall()
        totals = g.db.execute(
            """
            SELECT project, SUM(hours) AS total_hours
            FROM entries
            WHERE user_id = ? AND entry_date BETWEEN ? AND ?
            GROUP BY project
            ORDER BY project COLLATE NOCASE
            """,
            (current_user_id(), week_start.isoformat(), week_end.isoformat()),
        ).fetchall()
        week_total = sum(Decimal(str(row["total_hours"] or "0")) for row in totals)
        return render_template(
            "dashboard.html",
            entries=entries,
            totals=totals,
            week_start=week_start,
            week_end=week_end,
            prev_week=(week_start - timedelta(days=7)).isoformat(),
            next_week=(week_start + timedelta(days=7)).isoformat(),
            today=date.today().isoformat(),
            week_total=week_total,
        )

    @app.route("/entries/<int:entry_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_entry(entry_id):
        entry = get_own_entry_or_404(entry_id)
        if request.method == "POST":
            updated, errors = read_entry_form()
            if errors:
                for error in errors:
                    flash(error)
            else:
                g.db.execute(
                    """
                    UPDATE entries
                    SET project = ?, entry_date = ?, hours = ?, note = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        updated["project"],
                        updated["entry_date"],
                        str(updated["hours"]),
                        updated["note"],
                        entry_id,
                        current_user_id(),
                    ),
                )
                g.db.commit()
                return redirect(url_for("dashboard", week=updated["entry_date"]))
        return render_template("edit_entry.html", entry=entry)

    @app.post("/entries/<int:entry_id>/delete")
    @login_required
    def delete_entry(entry_id):
        entry = get_own_entry_or_404(entry_id)
        g.db.execute(
            "DELETE FROM entries WHERE id = ? AND user_id = ?",
            (entry["id"], current_user_id()),
        )
        g.db.commit()
        return redirect(url_for("dashboard", week=entry["entry_date"]))

    return app


def init_db(db):
    db.execute("PRAGMA foreign_keys = ON")
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            project TEXT NOT NULL,
            entry_date TEXT NOT NULL,
            hours REAL NOT NULL CHECK (hours > 0 AND hours <= 24),
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_entries_user_date ON entries(user_id, entry_date)"
    )
    db.commit()


def current_user_id():
    return session.get("user_id")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user_id():
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def get_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf():
    form_token = request.form.get("csrf_token", "")
    session_token = session.get("csrf_token", "")
    if not form_token or not session_token or not secrets.compare_digest(form_token, session_token):
        abort(400, description="Invalid CSRF token.")


def verify_password(stored_hash, password):
    try:
        return PASSWORD_HASHER.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, TypeError):
        return False


def clean_text(value, max_length):
    cleaned = "".join(ch for ch in value.strip() if ch.isprintable())
    return cleaned[:max_length]


def parse_week(value):
    if not value:
        return date.today()
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return date.today()


def read_entry_form():
    errors = []
    project = clean_text(request.form.get("project", ""), 80)
    note = clean_text(request.form.get("note", ""), 500)
    entry_date_raw = request.form.get("entry_date", "")
    hours_raw = request.form.get("hours", "")

    if not project:
        errors.append("Project is required.")

    try:
        entry_date = datetime.strptime(entry_date_raw, "%Y-%m-%d").date()
    except ValueError:
        entry_date = None
        errors.append("Enter a valid date.")

    try:
        hours = Decimal(hours_raw)
        if hours <= 0 or hours > 24:
            errors.append("Hours must be greater than 0 and no more than 24.")
        hours = hours.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        hours = Decimal("0")
        errors.append("Enter valid hours.")

    return (
        {
            "project": project,
            "entry_date": entry_date.isoformat() if entry_date else "",
            "hours": hours,
            "note": note,
        },
        errors,
    )


def get_own_entry_or_404(entry_id):
    entry = g.db.execute(
        """
        SELECT id, project, entry_date, hours, note
        FROM entries
        WHERE id = ? AND user_id = ?
        """,
        (entry_id, current_user_id()),
    ).fetchone()
    if entry is None:
        abort(404)
    return entry


app = create_app()
