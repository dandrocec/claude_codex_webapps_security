"""
Flask image-resizing web app.

Users register / log in, upload an image, choose a target width, and the app
generates a resized thumbnail that is displayed with a download link. Uploaded
images belong to the uploading user; access control is enforced on view and
download to prevent IDOR.

Security posture (OWASP Top 10):
  * SQL injection ......... parameterised queries only (sqlite3 placeholders)
  * Auth / passwords ...... Argon2id hashing (argon2-cffi) with per-user salt
  * XSS ................... Jinja2 autoescaping + strict CSP, no raw HTML sinks
  * CSRF .................. Flask-WTF CSRFProtect on every state-changing POST
  * Access control / IDOR . ownership check on every image view & download
  * Sessions ............. HttpOnly + SameSite=Lax + Secure (configurable) cookies
  * Security headers ...... CSP, X-Content-Type-Options, X-Frame-Options, etc.
  * Error handling ........ generic error pages, no stack traces to clients
  * Secrets ............... read from environment, never hardcoded
  * Upload hardening ...... content-sniffed allow-list, size cap, random names,
                            storage outside the web root, no path traversal
"""

import io
import os
import secrets
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

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
    send_file,
    session,
    url_for,
)
from flask_wtf import CSRFProtect
from PIL import Image, UnidentifiedImageError
from werkzeug.exceptions import HTTPException

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

BASE_DIR = Path(__file__).resolve().parent
# Uploads live OUTSIDE the static/template tree so they are never served as
# code and never interpreted by the app server.
UPLOAD_DIR = (BASE_DIR / "instance" / "uploads").resolve()
DB_PATH = (BASE_DIR / "instance" / "app.db").resolve()

# Allow-list of accepted image formats, keyed by the value Pillow reports after
# it has actually decoded the file. The client filename / Content-Type is never
# trusted. Map -> (canonical extension, Pillow save format).
ALLOWED_FORMATS = {
    "JPEG": (".jpg", "JPEG"),
    "PNG": (".png", "PNG"),
    "GIF": (".gif", "GIF"),
    "WEBP": (".webp", "WEBP"),
}

MAX_CONTENT_LENGTH = 8 * 1024 * 1024  # 8 MiB hard cap on request body
MAX_DIMENSION = 10_000  # guard against decompression-bomb style huge canvases
MIN_WIDTH = 1
MAX_WIDTH = 5_000

ph = PasswordHasher()  # Argon2id with sane defaults


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def create_app() -> Flask:
    app = Flask(__name__)

    secret = os.environ.get("SECRET_KEY")
    if not secret:
        # Keep the app runnable for local dev, but make the weakness loud and
        # never silently ship a hardcoded key. Sessions reset on restart.
        secret = secrets.token_hex(32)
        app.logger.warning(
            "SECRET_KEY not set; using a random ephemeral key. "
            "Set SECRET_KEY in the environment for any real deployment."
        )

    app.config.update(
        SECRET_KEY=secret,
        MAX_CONTENT_LENGTH=MAX_CONTENT_LENGTH,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure by default. For plain-HTTP localhost testing set
        # SECURE_COOKIES=false (see README), otherwise the browser will refuse
        # to send the cookie and login will appear to "not work".
        SESSION_COOKIE_SECURE=_env_bool("SECURE_COOKIES", True),
        PERMANENT_SESSION_LIFETIME=60 * 60 * 8,  # 8 hours
        WTF_CSRF_TIME_LIMIT=None,
    )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    CSRFProtect(app)

    register_db(app)
    register_security_headers(app)
    register_error_handlers(app)
    register_routes(app)

    with app.app_context():
        init_db()

    return app


# --------------------------------------------------------------------------- #
# Database (sqlite3, parameterised queries only)
# --------------------------------------------------------------------------- #

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS images (
    id            TEXT    PRIMARY KEY,           -- random uuid4 hex
    owner_id      INTEGER NOT NULL,
    stored_name   TEXT    NOT NULL,              -- server-generated filename on disk
    original_name TEXT    NOT NULL,              -- sanitised, display only
    img_format    TEXT    NOT NULL,
    width         INTEGER NOT NULL,
    height        INTEGER NOT NULL,
    created_at    TEXT    NOT NULL,
    FOREIGN KEY (owner_id) REFERENCES users (id)
);
"""


def register_db(app: Flask) -> None:
    @app.teardown_appcontext
    def close_db(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        g.db = conn
    return g.db


def init_db() -> None:
    db = get_db()
    db.executescript(SCHEMA)
    db.commit()


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #

def current_user():
    uid = session.get("user_id")
    if uid is None:
        return None
    row = get_db().execute(
        "SELECT id, username FROM users WHERE id = ?", (uid,)
    ).fetchone()
    return row


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def valid_username(name: str) -> bool:
    return bool(name) and 3 <= len(name) <= 32 and name.isalnum()


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #

def register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_headers(resp):
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; "
            "style-src 'self'; script-src 'self'; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        resp.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            resp.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return resp


# --------------------------------------------------------------------------- #
# Error handling (no stack traces / internals leak to clients)
# --------------------------------------------------------------------------- #

def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(HTTPException)
    def handle_http_exc(exc: HTTPException):
        return (
            render_template("error.html", code=exc.code, message=exc.name),
            exc.code,
        )

    @app.errorhandler(Exception)
    def handle_unexpected(exc: Exception):
        app.logger.exception("Unhandled exception: %s", exc)
        return (
            render_template(
                "error.html", code=500, message="Internal Server Error"
            ),
            500,
        )


# --------------------------------------------------------------------------- #
# Image handling
# --------------------------------------------------------------------------- #

def safe_stored_path(stored_name: str) -> Path:
    """Resolve a stored filename strictly inside UPLOAD_DIR (anti path-traversal)."""
    candidate = (UPLOAD_DIR / stored_name).resolve()
    if candidate.parent != UPLOAD_DIR or not candidate.is_file():
        abort(404)
    return candidate


def process_upload(file_storage, target_width: int):
    """Validate by decoded content, resize, persist. Returns (stored_name, fmt, w, h)."""
    raw = file_storage.read()
    if not raw:
        raise ValueError("The uploaded file is empty.")

    # First pass: verify() proves the bytes are a real, decodable image.
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            probe.verify()
            fmt = probe.format
    except (UnidentifiedImageError, OSError, ValueError):
        raise ValueError("That file is not a recognised image.")

    if fmt not in ALLOWED_FORMATS:
        raise ValueError(
            "Unsupported image type. Allowed: JPEG, PNG, GIF, WEBP."
        )

    # Second pass: actually load for processing (verify() leaves it unusable).
    try:
        image = Image.open(io.BytesIO(raw))
        image.load()
    except (UnidentifiedImageError, OSError):
        raise ValueError("That file is not a recognised image.")

    if max(image.size) > MAX_DIMENSION:
        raise ValueError("Image dimensions are too large to process.")

    width = max(MIN_WIDTH, min(MAX_WIDTH, target_width))
    if width >= image.width:
        # Never upscale; cap at the source width.
        width = image.width
    ratio = width / float(image.width)
    height = max(1, int(round(image.height * ratio)))

    ext, save_fmt = ALLOWED_FORMATS[fmt]
    if save_fmt in {"JPEG"} and image.mode in {"RGBA", "P"}:
        image = image.convert("RGB")

    resized = image.resize((width, height), Image.LANCZOS)

    stored_name = f"{uuid.uuid4().hex}{ext}"
    dest = (UPLOAD_DIR / stored_name).resolve()
    if dest.parent != UPLOAD_DIR:  # defensive; uuid hex can't traverse
        raise ValueError("Invalid storage path.")

    save_kwargs = {}
    if save_fmt == "JPEG":
        save_kwargs.update(quality=85, optimize=True)
    resized.save(dest, format=save_fmt, **save_kwargs)

    return stored_name, save_fmt, width, height


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #

def register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        user = current_user()
        if user is None:
            return render_template("index.html", user=None, images=[])
        rows = get_db().execute(
            "SELECT id, original_name, width, height, created_at "
            "FROM images WHERE owner_id = ? ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
        return render_template("index.html", user=user, images=rows)

    # ---- Auth -----------------------------------------------------------

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user():
            return redirect(url_for("index"))
        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            password = request.form.get("password") or ""
            if not valid_username(username):
                flash("Username must be 3-32 alphanumeric characters.", "error")
            elif len(password) < 10:
                flash("Password must be at least 10 characters.", "error")
            else:
                db = get_db()
                exists = db.execute(
                    "SELECT 1 FROM users WHERE username = ?", (username,)
                ).fetchone()
                if exists:
                    flash("That username is taken.", "error")
                else:
                    db.execute(
                        "INSERT INTO users (username, password_hash, created_at) "
                        "VALUES (?, ?, ?)",
                        (username, ph.hash(password), _now()),
                    )
                    db.commit()
                    flash("Account created. Please log in.", "success")
                    return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user():
            return redirect(url_for("index"))
        if request.method == "POST":
            username = (request.form.get("username") or "").strip()
            password = request.form.get("password") or ""
            row = get_db().execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            if row and _verify_password(row["password_hash"], password):
                session.clear()
                session["user_id"] = row["id"]
                session.permanent = True
                _maybe_rehash(row["id"], row["password_hash"], password)
                return _safe_redirect(request.args.get("next"))
            # Uniform message: do not reveal whether the username exists.
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("You have been logged out.", "success")
        return redirect(url_for("index"))

    # ---- Image upload / resize -----------------------------------------

    @app.route("/upload", methods=["POST"])
    @login_required
    def upload():
        user = current_user()
        file = request.files.get("image")
        if file is None or not file.filename:
            flash("Please choose an image to upload.", "error")
            return redirect(url_for("index"))

        try:
            target_width = int(request.form.get("width", ""))
        except (TypeError, ValueError):
            flash("Please enter a valid target width.", "error")
            return redirect(url_for("index"))

        if not (MIN_WIDTH <= target_width <= MAX_WIDTH):
            flash(f"Width must be between {MIN_WIDTH} and {MAX_WIDTH}px.", "error")
            return redirect(url_for("index"))

        try:
            stored_name, fmt, w, h = process_upload(file, target_width)
        except ValueError as exc:
            flash(str(exc), "error")
            return redirect(url_for("index"))

        image_id = uuid.uuid4().hex
        # original_name is kept only for display; it is sanitised and never
        # used as a filesystem path.
        original = _sanitise_display_name(file.filename)
        db = get_db()
        db.execute(
            "INSERT INTO images "
            "(id, owner_id, stored_name, original_name, img_format, width, height, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (image_id, user["id"], stored_name, original, fmt, w, h, _now()),
        )
        db.commit()
        return redirect(url_for("result", image_id=image_id))

    @app.route("/image/<image_id>")
    @login_required
    def result(image_id: str):
        row = _owned_image_or_404(image_id)
        return render_template("result.html", user=current_user(), image=row)

    @app.route("/image/<image_id>/raw")
    @login_required
    def raw_image(image_id: str):
        row = _owned_image_or_404(image_id)
        path = safe_stored_path(row["stored_name"])
        return send_file(path, mimetype=_mime_for(row["img_format"]))

    @app.route("/image/<image_id>/download")
    @login_required
    def download_image(image_id: str):
        row = _owned_image_or_404(image_id)
        path = safe_stored_path(row["stored_name"])
        ext = ALLOWED_FORMATS[_format_key(row["img_format"])][0]
        download_name = f"thumbnail-{row['width']}px{ext}"
        return send_file(
            path,
            mimetype=_mime_for(row["img_format"]),
            as_attachment=True,
            download_name=download_name,
        )

    @app.route("/image/<image_id>/delete", methods=["POST"])
    @login_required
    def delete_image(image_id: str):
        row = _owned_image_or_404(image_id)
        path = (UPLOAD_DIR / row["stored_name"]).resolve()
        db = get_db()
        db.execute("DELETE FROM images WHERE id = ?", (row["id"],))
        db.commit()
        try:
            if path.parent == UPLOAD_DIR and path.is_file():
                path.unlink()
        except OSError:
            app.logger.warning("Could not remove file for image %s", image_id)
        flash("Image deleted.", "success")
        return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #

def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _owned_image_or_404(image_id: str):
    """Fetch an image only if it belongs to the logged-in user (anti-IDOR)."""
    user = current_user()
    row = get_db().execute(
        "SELECT * FROM images WHERE id = ? AND owner_id = ?",
        (image_id, user["id"]),
    ).fetchone()
    if row is None:
        abort(404)
    return row


def _verify_password(stored_hash: str, password: str) -> bool:
    try:
        return ph.verify(stored_hash, password)
    except (VerifyMismatchError, InvalidHashError, Exception):
        return False


def _maybe_rehash(user_id: int, stored_hash: str, password: str) -> None:
    try:
        if ph.check_needs_rehash(stored_hash):
            db = get_db()
            db.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (ph.hash(password), user_id),
            )
            db.commit()
    except Exception:  # never let a rehash failure block login
        pass


def _format_key(fmt: str) -> str:
    return fmt.upper()


def _mime_for(fmt: str) -> str:
    return {
        "JPEG": "image/jpeg",
        "PNG": "image/png",
        "GIF": "image/gif",
        "WEBP": "image/webp",
    }.get(_format_key(fmt), "application/octet-stream")


def _sanitise_display_name(name: str) -> str:
    """Keep a friendly label only; strip anything path-like or controly."""
    name = os.path.basename(name or "")
    cleaned = "".join(c for c in name if c.isalnum() or c in (" ", ".", "-", "_"))
    cleaned = cleaned.strip() or "image"
    return cleaned[:80]


def _safe_redirect(target: str | None):
    """Only redirect to local paths to avoid open-redirect."""
    if target and target.startswith("/") and not target.startswith("//"):
        return redirect(target)
    return redirect(url_for("index"))


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5011"))
    # debug stays off so tracebacks never reach clients.
    app.run(host="127.0.0.1", port=port, debug=False)
