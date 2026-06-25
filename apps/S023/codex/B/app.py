import os
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps

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


DATABASE = os.environ.get("PASTEBIN_DATABASE", "pastebin.sqlite3")
MAX_PASTE_LENGTH = 20_000
MAX_USERNAME_LENGTH = 40
ph = PasswordHasher()


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY"),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("PASTEBIN_COOKIE_SECURE", "true").lower()
        not in {"0", "false", "no"},
        SESSION_COOKIE_SAMESITE="Strict",
        PERMANENT_SESSION_LIFETIME=3600,
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    if not app.config["SECRET_KEY"]:
        raise RuntimeError("SECRET_KEY environment variable is required")

    register_db(app)
    register_security(app)
    register_routes(app)
    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def register_db(app):
    with app.app_context():
        db = sqlite3.connect(DATABASE)
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS pastes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                token TEXT NOT NULL UNIQUE,
                user_id INTEGER NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
        db.close()

    @app.teardown_appcontext
    def close_db(_error):
        db = g.pop("db", None)
        if db is not None:
            db.close()


def register_security(app):
    @app.before_request
    def load_user_and_protect_csrf():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = get_db().execute(
                "SELECT id, username FROM users WHERE id = ?", (user_id,)
            ).fetchone()

        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            submitted = request.form.get("csrf_token", "")
            expected = session.get("csrf_token", "")
            if not submitted or not secrets.compare_digest(submitted, expected):
                abort(400)

    @app.context_processor
    def csrf_context():
        return {"csrf_token": get_csrf_token}

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'; object-src 'none'; style-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", message="Access denied."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", message="Not found."), 404

    @app.errorhandler(500)
    def server_error(_error):
        return render_template("error.html", message="Something went wrong."), 500


def get_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in first.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def clean_username(value):
    username = (value or "").strip()
    if not 3 <= len(username) <= MAX_USERNAME_LENGTH:
        return None
    if not all(ch.isalnum() or ch in {"_", "-"} for ch in username):
        return None
    return username


def validate_password(value):
    return isinstance(value, str) and len(value) >= 12 and len(value) <= 256


def validate_paste(value):
    body = (value or "").strip()
    if not body or len(body) > MAX_PASTE_LENGTH:
        return None
    return body


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def register_routes(app):
    @app.route("/")
    def index():
        if g.user is None:
            return render_template("home.html")
        pastes = get_db().execute(
            """
            SELECT token, substr(body, 1, 120) AS preview, created_at
            FROM pastes
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 25
            """,
            (g.user["id"],),
        ).fetchall()
        return render_template("dashboard.html", pastes=pastes)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = clean_username(request.form.get("username"))
            password = request.form.get("password", "")
            if username is None or not validate_password(password):
                flash("Use a 3-40 character username and a 12+ character password.", "error")
                return render_template("register.html"), 400
            try:
                cursor = get_db().execute(
                    "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
                    (username, ph.hash(password), now_iso()),
                )
                get_db().commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
                return render_template("register.html"), 409
            session.clear()
            session["user_id"] = cursor.lastrowid
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("index"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_username(request.form.get("username"))
            password = request.form.get("password", "")
            user = None
            if username:
                user = get_db().execute(
                    "SELECT id, password_hash FROM users WHERE username = ?", (username,)
                ).fetchone()
            if user is None:
                flash("Invalid username or password.", "error")
                return render_template("login.html"), 401
            try:
                verified = ph.verify(user["password_hash"], password)
            except (VerifyMismatchError, VerificationError):
                verified = False
            if not verified:
                flash("Invalid username or password.", "error")
                return render_template("login.html"), 401
            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("index"))
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/pastes", methods=["POST"])
    @login_required
    def create_paste():
        body = validate_paste(request.form.get("body"))
        if body is None:
            flash(f"Paste text is required and must be at most {MAX_PASTE_LENGTH} characters.", "error")
            return redirect(url_for("index"))

        token = secrets.token_urlsafe(18)
        get_db().execute(
            "INSERT INTO pastes (token, user_id, body, created_at) VALUES (?, ?, ?, ?)",
            (token, g.user["id"], body, now_iso()),
        )
        get_db().commit()
        return redirect(url_for("view_paste", token=token))

    @app.route("/p/<token>")
    def view_paste(token):
        if len(token) > 80:
            abort(404)
        paste = get_db().execute(
            """
            SELECT pastes.token, pastes.body, pastes.created_at, users.username, pastes.user_id
            FROM pastes
            JOIN users ON users.id = pastes.user_id
            WHERE pastes.token = ?
            """,
            (token,),
        ).fetchone()
        if paste is None:
            abort(404)
        owner = g.user is not None and g.user["id"] == paste["user_id"]
        return render_template("paste.html", paste=paste, owner=owner)

    @app.route("/p/<token>/delete", methods=["POST"])
    @login_required
    def delete_paste(token):
        cursor = get_db().execute(
            "DELETE FROM pastes WHERE token = ? AND user_id = ?", (token, g.user["id"])
        )
        get_db().commit()
        if cursor.rowcount == 0:
            abort(403)
        flash("Paste deleted.", "success")
        return redirect(url_for("index"))

    @app.route("/health")
    def health():
        return "ok", 200, {"Content-Type": "text/plain; charset=utf-8"}


app = create_app()
