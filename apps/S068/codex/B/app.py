import os
import re
import sqlite3
from datetime import datetime
from functools import wraps
from html import escape

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
from flask_wtf import CSRFProtect
from werkzeug.exceptions import HTTPException


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_URL", os.path.join(BASE_DIR, "scheduler.sqlite3"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")
NAME_RE = re.compile(r"^[A-Za-z0-9 .,'_-]{2,80}$")


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        WTF_CSRF_TIME_LIMIT=3600,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") == "1",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=3600,
        MAX_CONTENT_LENGTH=1024 * 64,
    )
    CSRFProtect(app)

    @app.before_request
    def before_request():
        g.db = get_db()
        g.user = current_user()

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'"
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
    def close_db(_error):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.errorhandler(Exception)
    def handle_error(error):
        code = error.code if isinstance(error, HTTPException) else 500
        message = error.description if isinstance(error, HTTPException) and code < 500 else "An unexpected error occurred."
        return render_template("error.html", code=code, message=message), code

    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("dashboard"))
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = clean_text(request.form.get("username", ""))
            display_name = clean_text(request.form.get("display_name", ""))
            password = request.form.get("password", "")
            role = request.form.get("role", "")

            errors = validate_registration(username, display_name, password, role)
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("register.html", username=username, display_name=display_name, role=role), 400

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            try:
                g.db.execute(
                    "INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)",
                    (username, display_name, password_hash, role),
                )
                g.db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
                return render_template("register.html", username=username, display_name=display_name, role=role), 409

            flash("Account created. Please sign in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_text(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = g.db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            valid = bool(user and bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")))
            if not valid:
                flash("Invalid username or password.", "error")
                return render_template("login.html", username=username), 401

            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            flash("Signed in.", "success")
            return redirect(url_for("dashboard"))
        return render_template("login.html")

    @app.post("/logout")
    @login_required
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        if g.user["role"] == "provider":
            slots = g.db.execute(
                """
                SELECT s.id, s.starts_at, s.ends_at, s.status,
                       a.id AS appointment_id, c.display_name AS client_name
                FROM slots s
                LEFT JOIN appointments a ON a.slot_id = s.id
                LEFT JOIN users c ON c.id = a.client_id
                WHERE s.provider_id = ?
                ORDER BY s.starts_at
                """,
                (g.user["id"],),
            ).fetchall()
            return render_template("provider_dashboard.html", slots=slots)

        appointments = g.db.execute(
            """
            SELECT a.id, a.confirmation_code, a.created_at,
                   s.starts_at, s.ends_at, p.display_name AS provider_name
            FROM appointments a
            JOIN slots s ON s.id = a.slot_id
            JOIN users p ON p.id = s.provider_id
            WHERE a.client_id = ?
            ORDER BY s.starts_at
            """,
            (g.user["id"],),
        ).fetchall()
        open_slots = g.db.execute(
            """
            SELECT s.id, s.starts_at, s.ends_at, p.display_name AS provider_name
            FROM slots s
            JOIN users p ON p.id = s.provider_id
            WHERE s.status = 'available' AND s.starts_at > ?
            ORDER BY s.starts_at
            """,
            (datetime.utcnow().isoformat(timespec="seconds"),),
        ).fetchall()
        return render_template("client_dashboard.html", appointments=appointments, open_slots=open_slots)

    @app.post("/slots")
    @login_required
    @role_required("provider")
    def create_slot():
        starts_at_raw = request.form.get("starts_at", "")
        ends_at_raw = request.form.get("ends_at", "")
        starts_at, ends_at, error = parse_slot_times(starts_at_raw, ends_at_raw)
        if error:
            flash(error, "error")
            return redirect(url_for("dashboard"))

        g.db.execute(
            "INSERT INTO slots (provider_id, starts_at, ends_at, status) VALUES (?, ?, ?, 'available')",
            (g.user["id"], starts_at.isoformat(timespec="seconds"), ends_at.isoformat(timespec="seconds")),
        )
        g.db.commit()
        flash("Slot published.", "success")
        return redirect(url_for("dashboard"))

    @app.post("/slots/<int:slot_id>/delete")
    @login_required
    @role_required("provider")
    def delete_slot(slot_id):
        slot = g.db.execute("SELECT * FROM slots WHERE id = ? AND provider_id = ?", (slot_id, g.user["id"])).fetchone()
        if not slot:
            abort(404)
        if slot["status"] != "available":
            flash("Booked slots cannot be deleted.", "error")
            return redirect(url_for("dashboard"))

        g.db.execute("DELETE FROM slots WHERE id = ? AND provider_id = ?", (slot_id, g.user["id"]))
        g.db.commit()
        flash("Slot removed.", "success")
        return redirect(url_for("dashboard"))

    @app.post("/slots/<int:slot_id>/book")
    @login_required
    @role_required("client")
    def book_slot(slot_id):
        try:
            g.db.execute("BEGIN IMMEDIATE")
            slot = g.db.execute("SELECT * FROM slots WHERE id = ? AND status = 'available'", (slot_id,)).fetchone()
            if not slot:
                g.db.rollback()
                flash("That slot is no longer available.", "error")
                return redirect(url_for("dashboard"))

            confirmation_code = f"CONF-{os.urandom(6).hex().upper()}"
            g.db.execute(
                "INSERT INTO appointments (slot_id, client_id, confirmation_code) VALUES (?, ?, ?)",
                (slot_id, g.user["id"], confirmation_code),
            )
            g.db.execute("UPDATE slots SET status = 'booked' WHERE id = ? AND status = 'available'", (slot_id,))
            g.db.commit()
            flash(f"Booked. Confirmation: {escape(confirmation_code)}", "success")
        except sqlite3.IntegrityError:
            g.db.rollback()
            flash("That slot is no longer available.", "error")
        return redirect(url_for("dashboard"))

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    return app


def get_db():
    db = sqlite3.connect(DATABASE, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def init_db():
    db = sqlite3.connect(DATABASE)
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('provider', 'client')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS slots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider_id INTEGER NOT NULL,
            starts_at TEXT NOT NULL,
            ends_at TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('available', 'booked')) DEFAULT 'available',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
            CHECK (ends_at > starts_at)
        );

        CREATE TABLE IF NOT EXISTS appointments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slot_id INTEGER NOT NULL UNIQUE,
            client_id INTEGER NOT NULL,
            confirmation_code TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE,
            FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_slots_provider_id ON slots(provider_id);
        CREATE INDEX IF NOT EXISTS idx_slots_status_starts ON slots(status, starts_at);
        CREATE INDEX IF NOT EXISTS idx_appointments_client_id ON appointments(client_id);
        """
    )
    db.commit()
    db.close()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return g.db.execute("SELECT id, username, display_name, role FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please sign in first.", "error")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def role_required(role):
    def decorator(view):
        @wraps(view)
        def wrapped_view(**kwargs):
            if g.user["role"] != role:
                abort(403)
            return view(**kwargs)

        return wrapped_view

    return decorator


def clean_text(value):
    return re.sub(r"\s+", " ", value.strip())


def validate_registration(username, display_name, password, role):
    errors = []
    if not USERNAME_RE.fullmatch(username):
        errors.append("Username must be 3-40 characters and use only letters, numbers, dots, dashes, or underscores.")
    if not NAME_RE.fullmatch(display_name):
        errors.append("Display name must be 2-80 characters and use ordinary name characters.")
    if role not in {"provider", "client"}:
        errors.append("Choose provider or client.")
    if len(password) < 12:
        errors.append("Password must be at least 12 characters.")
    if len(password) > 256:
        errors.append("Password is too long.")
    return errors


def parse_slot_times(starts_at_raw, ends_at_raw):
    try:
        starts_at = datetime.fromisoformat(starts_at_raw)
        ends_at = datetime.fromisoformat(ends_at_raw)
    except ValueError:
        return None, None, "Enter valid start and end times."

    if starts_at <= datetime.utcnow():
        return None, None, "Slots must start in the future."
    if ends_at <= starts_at:
        return None, None, "End time must be after start time."
    if (ends_at - starts_at).total_seconds() > 8 * 60 * 60:
        return None, None, "Slots cannot be longer than 8 hours."
    return starts_at, ends_at, None


app = create_app()


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", "5068"))
    ssl_context = "adhoc" if os.environ.get("FLASK_HTTPS_ADHOC", "1") == "1" else None
    app.run(host="127.0.0.1", port=port, debug=False, ssl_context=ssl_context)
