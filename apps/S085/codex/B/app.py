import io
import os
import secrets
import sqlite3
import zipfile
from datetime import timedelta
from functools import wraps
from pathlib import Path

import bcrypt
import bleach
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
from markupsafe import Markup
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "instance" / "recruitment.sqlite3"
UPLOAD_DIR = BASE_DIR / "instance" / "uploads"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt"}
ALLOWED_BLEACH_TAGS = []
ALLOWED_BLEACH_ATTRIBUTES = {}


csrf = CSRFProtect()


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        != "false",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        WTF_CSRF_TIME_LIMIT=3600,
    )
    csrf.init_app(app)

    app.jinja_env.globals["csrf_field"] = csrf_field

    @app.before_request
    def load_current_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = query_one(
                "SELECT id, email, role FROM users WHERE id = ?", (user_id,)
            )

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self'; object-src 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

    @app.errorhandler(RequestEntityTooLarge)
    def upload_too_large(_error):
        return render_template("error.html", message="Uploaded file is too large."), 413

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            message = error.description if error.code in {400, 403, 404} else "Request failed."
            return render_template("error.html", message=message), error.code
        app.logger.exception("Unhandled application error")
        return render_template("error.html", message="An internal error occurred."), 500

    register_routes(app)
    with app.app_context():
        init_db()
    return app


def get_db():
    if "db" not in g:
        DATABASE.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


def init_db():
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash BLOB NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('candidate', 'recruiter')),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS candidate_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            headline TEXT NOT NULL DEFAULT '',
            skills TEXT NOT NULL DEFAULT '',
            experience TEXT NOT NULL DEFAULT '',
            resume_filename TEXT,
            resume_original_ext TEXT,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def sanitize_text(value, max_len):
    cleaned = bleach.clean(
        (value or "").strip(),
        tags=ALLOWED_BLEACH_TAGS,
        attributes=ALLOWED_BLEACH_ATTRIBUTES,
        strip=True,
    )
    return cleaned[:max_len]


def csrf_field():
    from flask_wtf.csrf import generate_csrf

    token = generate_csrf()
    return Markup(f'<input type="hidden" name="csrf_token" value="{token}">')


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please sign in first.", "warning")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def role_required(role):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if g.user is None:
                flash("Please sign in first.", "warning")
                return redirect(url_for("login"))
            if g.user["role"] != role:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))


def verify_password(password, password_hash):
    return bcrypt.checkpw(password.encode("utf-8"), password_hash)


def inspect_resume(file_storage):
    data = file_storage.read(MAX_UPLOAD_BYTES + 1)
    file_storage.stream.seek(0)
    if len(data) > MAX_UPLOAD_BYTES:
        raise ValueError("Resume exceeds the 5 MB limit.")
    if not data:
        raise ValueError("Resume file is empty.")

    if data.startswith(b"%PDF-"):
        return "pdf"

    if data.startswith(b"PK\x03\x04"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                names = set(archive.namelist())
                if "[Content_Types].xml" in names and "word/document.xml" in names:
                    return "docx"
        except zipfile.BadZipFile:
            pass

    try:
        data.decode("utf-8")
        if b"\x00" not in data:
            return "txt"
    except UnicodeDecodeError:
        pass

    raise ValueError("Only PDF, DOCX, and UTF-8 TXT resumes are accepted.")


def save_resume(file_storage, current_filename=None):
    detected_ext = inspect_resume(file_storage)
    random_name = f"{secrets.token_urlsafe(24)}.{detected_ext}"
    destination = (UPLOAD_DIR / random_name).resolve()
    upload_root = UPLOAD_DIR.resolve()
    if upload_root not in destination.parents:
        raise ValueError("Invalid upload path.")

    file_storage.save(destination)
    if current_filename:
        old_path = (UPLOAD_DIR / current_filename).resolve()
        if upload_root in old_path.parents and old_path.exists():
            old_path.unlink()
    return random_name, detected_ext


def can_view_candidate(candidate_user_id):
    return (
        g.user
        and (g.user["role"] == "recruiter" or g.user["id"] == candidate_user_id)
    )


def register_routes(app):
    app.teardown_appcontext(close_db)

    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("dashboard"))
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            email = sanitize_text(request.form.get("email"), 254).lower()
            password = request.form.get("password", "")
            role = request.form.get("role", "")
            full_name = sanitize_text(request.form.get("full_name"), 120)

            errors = []
            if "@" not in email or len(email) < 5:
                errors.append("Enter a valid email address.")
            if len(password) < 12:
                errors.append("Password must be at least 12 characters.")
            if role not in {"candidate", "recruiter"}:
                errors.append("Choose a valid role.")
            if role == "candidate" and not full_name:
                errors.append("Candidates must enter a full name.")

            if errors:
                for error in errors:
                    flash(error, "danger")
                return render_template("register.html")

            try:
                db = get_db()
                cursor = db.execute(
                    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
                    (email, hash_password(password), role),
                )
                if role == "candidate":
                    db.execute(
                        "INSERT INTO candidate_profiles (user_id, full_name) VALUES (?, ?)",
                        (cursor.lastrowid, full_name),
                    )
                db.commit()
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))
            except sqlite3.IntegrityError:
                flash("That email is already registered.", "danger")

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = sanitize_text(request.form.get("email"), 254).lower()
            password = request.form.get("password", "")
            user = query_one(
                "SELECT id, email, password_hash, role FROM users WHERE email = ?",
                (email,),
            )
            if user and verify_password(password, user["password_hash"]):
                session.clear()
                session.permanent = True
                session["user_id"] = user["id"]
                flash("Signed in.", "success")
                return redirect(url_for("dashboard"))
            flash("Invalid email or password.", "danger")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        if g.user["role"] == "recruiter":
            return redirect(url_for("search_candidates"))
        profile = query_one(
            "SELECT * FROM candidate_profiles WHERE user_id = ?", (g.user["id"],)
        )
        return render_template("dashboard.html", profile=profile)

    @app.route("/profile/edit", methods=["GET", "POST"])
    @role_required("candidate")
    def edit_profile():
        profile = query_one(
            "SELECT * FROM candidate_profiles WHERE user_id = ?", (g.user["id"],)
        )
        if not profile:
            abort(404)

        if request.method == "POST":
            full_name = sanitize_text(request.form.get("full_name"), 120)
            headline = sanitize_text(request.form.get("headline"), 160)
            skills = sanitize_text(request.form.get("skills"), 500)
            experience = sanitize_text(request.form.get("experience"), 3000)
            if not full_name:
                flash("Full name is required.", "danger")
                return render_template("edit_profile.html", profile=profile)

            resume_filename = profile["resume_filename"]
            resume_ext = profile["resume_original_ext"]
            resume = request.files.get("resume")
            if resume and resume.filename:
                try:
                    resume_filename, resume_ext = save_resume(
                        resume, profile["resume_filename"]
                    )
                except ValueError as error:
                    flash(str(error), "danger")
                    return render_template("edit_profile.html", profile=profile)

            get_db().execute(
                """
                UPDATE candidate_profiles
                SET full_name = ?, headline = ?, skills = ?, experience = ?,
                    resume_filename = ?, resume_original_ext = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = ?
                """,
                (
                    full_name,
                    headline,
                    skills,
                    experience,
                    resume_filename,
                    resume_ext,
                    g.user["id"],
                ),
            )
            get_db().commit()
            flash("Profile updated.", "success")
            return redirect(url_for("dashboard"))

        return render_template("edit_profile.html", profile=profile)

    @app.route("/candidates")
    @role_required("recruiter")
    def search_candidates():
        skill = sanitize_text(request.args.get("skill"), 80)
        profiles = []
        if skill:
            profiles = get_db().execute(
                """
                SELECT cp.*, u.email
                FROM candidate_profiles cp
                JOIN users u ON u.id = cp.user_id
                WHERE lower(cp.skills) LIKE lower(?)
                ORDER BY cp.updated_at DESC
                LIMIT 50
                """,
                (f"%{skill}%",),
            ).fetchall()
        else:
            profiles = get_db().execute(
                """
                SELECT cp.*, u.email
                FROM candidate_profiles cp
                JOIN users u ON u.id = cp.user_id
                ORDER BY cp.updated_at DESC
                LIMIT 50
                """
            ).fetchall()
        return render_template("search.html", profiles=profiles, skill=skill)

    @app.route("/candidates/<int:user_id>")
    @login_required
    def view_candidate(user_id):
        profile = query_one(
            """
            SELECT cp.*, u.email
            FROM candidate_profiles cp
            JOIN users u ON u.id = cp.user_id
            WHERE cp.user_id = ?
            """,
            (user_id,),
        )
        if not profile:
            abort(404)
        if not can_view_candidate(profile["user_id"]):
            abort(403)
        return render_template("profile.html", profile=profile)

    @app.route("/candidates/<int:user_id>/resume")
    @login_required
    def download_resume(user_id):
        profile = query_one(
            "SELECT user_id, resume_filename, resume_original_ext FROM candidate_profiles WHERE user_id = ?",
            (user_id,),
        )
        if not profile or not profile["resume_filename"]:
            abort(404)
        if not can_view_candidate(profile["user_id"]):
            abort(403)

        upload_root = UPLOAD_DIR.resolve()
        resume_path = (UPLOAD_DIR / profile["resume_filename"]).resolve()
        if upload_root not in resume_path.parents or not resume_path.is_file():
            abort(404)

        return send_file(
            resume_path,
            as_attachment=True,
            download_name=f"resume.{profile['resume_original_ext']}",
            mimetype="application/octet-stream",
        )


app = create_app()
