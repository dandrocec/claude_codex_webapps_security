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
from werkzeug.exceptions import HTTPException


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "membership.sqlite3"
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_ -]{2,40}$")
ALLOWED_TIERS = {"free", "premium", "admin"}


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=1800,
        MAX_CONTENT_LENGTH=1024 * 1024,
    )

    if not app.config["SECRET_KEY"]:
        raise RuntimeError("SECRET_KEY environment variable is required.")

    register_security_hooks(app)
    register_routes(app)

    with app.app_context():
        init_db()
        bootstrap_admin()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            username TEXT NOT NULL,
            password_hash BLOB NOT NULL,
            tier TEXT NOT NULL CHECK (tier IN ('free', 'premium', 'admin')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.commit()


def bootstrap_admin():
    email = normalize_email(os.environ.get("ADMIN_EMAIL", ""))
    password = os.environ.get("ADMIN_PASSWORD", "")
    username = clean_text(os.environ.get("ADMIN_USERNAME", "Admin"), 40)

    if not email and not password:
        return
    if not valid_email(email) or not strong_password(password):
        raise RuntimeError("ADMIN_EMAIL and a strong ADMIN_PASSWORD are required to bootstrap admin.")

    db = get_db()
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        return

    db.execute(
        "INSERT INTO users (email, username, password_hash, tier) VALUES (?, ?, ?, ?)",
        (email, username, hash_password(password), "admin"),
    )
    db.commit()


def register_security_hooks(app):
    @app.before_request
    def load_current_user_and_protect_csrf():
        g.user = None
        user_id = session.get("user_id")
        if isinstance(user_id, int):
            g.user = get_db().execute(
                "SELECT id, email, username, tier, created_at FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if g.user is None:
                session.clear()

        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            token = session.get("csrf_token")
            submitted = request.form.get("csrf_token", "")
            if not token or not secrets.compare_digest(token, submitted):
                abort(400)

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.context_processor
    def inject_helpers():
        return {"csrf_token": csrf_token}

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            return render_template("error.html", code=error.code, message=error.name), error.code
        return render_template("error.html", code=500, message="Internal Server Error"), 500


def register_routes(app):
    @app.route("/")
    def index():
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if g.user:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            email = normalize_email(request.form.get("email", ""))
            username = clean_text(request.form.get("username", ""), 40)
            password = request.form.get("password", "")

            if not valid_email(email):
                flash("Enter a valid email address.", "error")
            elif not USERNAME_RE.match(username):
                flash("Usernames must be 2-40 letters, numbers, spaces, underscores, or hyphens.", "error")
            elif not strong_password(password):
                flash("Passwords must be at least 12 characters and include upper, lower, number, and symbol.", "error")
            else:
                try:
                    db = get_db()
                    cursor = db.execute(
                        "INSERT INTO users (email, username, password_hash, tier) VALUES (?, ?, ?, ?)",
                        (email, username, hash_password(password), "free"),
                    )
                    db.commit()
                    session.clear()
                    session["user_id"] = cursor.lastrowid
                    session.permanent = True
                    rotate_csrf_token()
                    return redirect(url_for("dashboard"))
                except sqlite3.IntegrityError:
                    flash("An account with that email already exists.", "error")

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if g.user:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            email = normalize_email(request.form.get("email", ""))
            password = request.form.get("password", "")
            user = get_db().execute(
                "SELECT id, email, password_hash FROM users WHERE email = ?",
                (email,),
            ).fetchone()

            if user and check_password(password, user["password_hash"]):
                session.clear()
                session["user_id"] = user["id"]
                session.permanent = True
                rotate_csrf_token()
                return redirect(url_for("dashboard"))
            flash("Invalid email or password.", "error")

        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        note = get_db().execute(
            "SELECT id, body, created_at FROM notes WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
            (g.user["id"],),
        ).fetchone()
        return render_template("dashboard.html", note=note)

    @app.route("/notes", methods=["POST"])
    @login_required
    def save_note():
        body = clean_text(request.form.get("body", ""), 500)
        if not body:
            flash("Note cannot be empty.", "error")
            return redirect(url_for("dashboard"))

        get_db().execute(
            "INSERT INTO notes (user_id, body) VALUES (?, ?)",
            (g.user["id"], body),
        )
        get_db().commit()
        flash("Note saved.", "success")
        return redirect(url_for("dashboard"))

    @app.route("/content/free")
    @login_required
    def free_content():
        return render_template("free_content.html")

    @app.route("/content/premium")
    @premium_required
    def premium_content():
        return render_template("premium_content.html")

    @app.route("/admin/users")
    @admin_required
    def admin_users():
        users = get_db().execute(
            "SELECT id, email, username, tier, created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
        return render_template("admin_users.html", users=users)

    @app.route("/admin/users/<int:user_id>/tier", methods=["POST"])
    @admin_required
    def change_tier(user_id):
        tier = request.form.get("tier", "")
        if tier not in ALLOWED_TIERS:
            abort(400)

        target = get_db().execute("SELECT id FROM users WHERE id = ?", (user_id,)).fetchone()
        if not target:
            abort(404)

        get_db().execute("UPDATE users SET tier = ? WHERE id = ?", (tier, user_id))
        get_db().commit()
        flash("Tier updated.", "success")
        return redirect(url_for("admin_users"))


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def premium_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login"))
        if g.user["tier"] not in {"premium", "admin"}:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login"))
        if g.user["tier"] != "admin":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def csrf_token():
    if "csrf_token" not in session:
        rotate_csrf_token()
    return session["csrf_token"]


def rotate_csrf_token():
    session["csrf_token"] = secrets.token_urlsafe(32)


def normalize_email(value):
    return clean_text(value, 320).lower()


def clean_text(value, max_length):
    value = (value or "").strip()
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    return value[:max_length]


def valid_email(email):
    return bool(email and EMAIL_RE.match(email))


def strong_password(password):
    if not isinstance(password, str) or len(password) < 12 or len(password) > 256:
        return False
    checks = [
        re.search(r"[a-z]", password),
        re.search(r"[A-Z]", password),
        re.search(r"\d", password),
        re.search(r"[^A-Za-z0-9]", password),
    ]
    return all(checks)


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))


def check_password(password, password_hash):
    try:
        stored = password_hash if isinstance(password_hash, bytes) else bytes(password_hash)
        return bcrypt.checkpw(password.encode("utf-8"), stored)
    except (TypeError, ValueError):
        return False


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5072"))
    app.run(host="127.0.0.1", port=port, ssl_context="adhoc")
