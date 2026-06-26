import os
import re
import secrets
import sqlite3
import uuid
import zipfile
from datetime import datetime, timezone
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
    send_from_directory,
    session,
    url_for,
)
from werkzeug.exceptions import RequestEntityTooLarge
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("DATABASE_URL", BASE_DIR / "recruiting.sqlite3"))
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", BASE_DIR / "instance" / "uploads")).resolve()
MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_BYTES", str(2 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {"pdf", "docx", "txt"}


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=require_secret_key(),
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=parse_bool(os.environ.get("SESSION_COOKIE_SECURE", "true")),
        SESSION_COOKIE_SAMESITE="Lax",
        WTF_CSRF_ENABLED=False,
    )

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    @app.before_request
    def before_request():
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        ensure_schema(g.db)
        if "csrf_token" not in session:
            session["csrf_token"] = secrets.token_urlsafe(32)

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
        return response

    @app.teardown_request
    def teardown_request(_exc):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.errorhandler(404)
    def not_found(_exc):
        return render_template("error.html", title="Not found", message="The page was not found."), 404

    @app.errorhandler(403)
    def forbidden(_exc):
        return render_template("error.html", title="Forbidden", message="You do not have access to this resource."), 403

    @app.errorhandler(RequestEntityTooLarge)
    def too_large(_exc):
        return render_template("error.html", title="File too large", message="Uploaded files must be 2 MB or smaller."), 413

    @app.errorhandler(500)
    def server_error(_exc):
        return render_template("error.html", title="Server error", message="An unexpected error occurred."), 500

    @app.context_processor
    def inject_globals():
        return {"csrf_token": session.get("csrf_token"), "current_user": current_user()}

    @app.route("/")
    def index():
        jobs = query_all(
            """
            SELECT jobs.*, users.name AS employer_name
            FROM jobs
            JOIN users ON users.id = jobs.employer_id
            WHERE jobs.is_active = 1
            ORDER BY jobs.created_at DESC
            """
        )
        return render_template("index.html", jobs=jobs)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            verify_csrf()
            name = clean_text(request.form.get("name"), 80)
            email = normalize_email(request.form.get("email"))
            password = request.form.get("password", "")
            role = request.form.get("role", "")
            errors = []
            if not name:
                errors.append("Name is required.")
            if not email:
                errors.append("A valid email address is required.")
            if role not in {"employer", "applicant"}:
                errors.append("Choose a valid account type.")
            if len(password) < 12:
                errors.append("Password must be at least 12 characters.")
            if query_one("SELECT id FROM users WHERE email = ?", (email,)):
                errors.append("An account with that email already exists.")
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("register.html", form=request.form), 400

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            execute(
                "INSERT INTO users (name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
                (name, email, password_hash, role, now_iso()),
            )
            flash("Account created. Sign in to continue.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form={})

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            verify_csrf()
            email = normalize_email(request.form.get("email"))
            password = request.form.get("password", "")
            user = query_one("SELECT * FROM users WHERE email = ?", (email,))
            if not user or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
                flash("Invalid email or password.", "error")
                return render_template("login.html", form=request.form), 400
            session.clear()
            session["csrf_token"] = secrets.token_urlsafe(32)
            session["user_id"] = user["id"]
            flash("Signed in.", "success")
            return redirect(url_for("dashboard"))
        return render_template("login.html", form={})

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        verify_csrf()
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        user = current_user()
        if user["role"] == "employer":
            jobs = query_all(
                """
                SELECT jobs.*,
                       COUNT(applications.id) AS application_count
                FROM jobs
                LEFT JOIN applications ON applications.job_id = jobs.id
                WHERE jobs.employer_id = ?
                GROUP BY jobs.id
                ORDER BY jobs.created_at DESC
                """,
                (user["id"],),
            )
            return render_template("employer_dashboard.html", jobs=jobs)

        applications = query_all(
            """
            SELECT applications.*, jobs.title, jobs.location, users.name AS employer_name
            FROM applications
            JOIN jobs ON jobs.id = applications.job_id
            JOIN users ON users.id = jobs.employer_id
            WHERE applications.applicant_id = ?
            ORDER BY applications.created_at DESC
            """,
            (user["id"],),
        )
        return render_template("applicant_dashboard.html", applications=applications)

    @app.route("/jobs/new", methods=["GET", "POST"])
    @role_required("employer")
    def new_job():
        if request.method == "POST":
            verify_csrf()
            title = clean_text(request.form.get("title"), 120)
            company = clean_text(request.form.get("company"), 120)
            location = clean_text(request.form.get("location"), 120)
            description = clean_multiline(request.form.get("description"), 4000)
            errors = []
            if not title:
                errors.append("Title is required.")
            if not company:
                errors.append("Company is required.")
            if not location:
                errors.append("Location is required.")
            if len(description) < 30:
                errors.append("Description must be at least 30 characters.")
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("job_form.html", form=request.form), 400
            execute(
                """
                INSERT INTO jobs (employer_id, title, company, location, description, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, 1, ?)
                """,
                (current_user()["id"], title, company, location, description, now_iso()),
            )
            flash("Job posted.", "success")
            return redirect(url_for("dashboard"))
        return render_template("job_form.html", form={})

    @app.route("/jobs/<int:job_id>")
    def job_detail(job_id):
        job = query_one(
            """
            SELECT jobs.*, users.name AS employer_name
            FROM jobs
            JOIN users ON users.id = jobs.employer_id
            WHERE jobs.id = ? AND jobs.is_active = 1
            """,
            (job_id,),
        )
        if not job:
            abort(404)
        existing = None
        user = current_user()
        if user and user["role"] == "applicant":
            existing = query_one(
                "SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?",
                (job_id, user["id"]),
            )
        return render_template("job_detail.html", job=job, existing=existing)

    @app.route("/jobs/<int:job_id>/apply", methods=["GET", "POST"])
    @role_required("applicant")
    def apply(job_id):
        job = query_one("SELECT * FROM jobs WHERE id = ? AND is_active = 1", (job_id,))
        if not job:
            abort(404)
        user = current_user()
        existing = query_one(
            "SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?",
            (job_id, user["id"]),
        )
        if existing:
            flash("You have already applied to this job.", "error")
            return redirect(url_for("job_detail", job_id=job_id))

        if request.method == "POST":
            verify_csrf()
            cover_letter = clean_multiline(request.form.get("cover_letter"), 4000)
            resume = request.files.get("resume")
            errors = []
            if len(cover_letter) < 20:
                errors.append("Cover letter must be at least 20 characters.")
            if not resume or not resume.filename:
                errors.append("Resume upload is required.")
            file_record = None
            if resume and resume.filename:
                file_record, upload_error = save_validated_resume(resume)
                if upload_error:
                    errors.append(upload_error)
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("apply.html", job=job, form=request.form), 400
            execute(
                """
                INSERT INTO applications
                    (job_id, applicant_id, cover_letter, resume_filename, resume_original_name, resume_type, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    job_id,
                    user["id"],
                    cover_letter,
                    file_record["stored_name"],
                    file_record["original_name"],
                    file_record["kind"],
                    now_iso(),
                ),
            )
            flash("Application submitted.", "success")
            return redirect(url_for("dashboard"))
        return render_template("apply.html", job=job, form={})

    @app.route("/jobs/<int:job_id>/applications")
    @role_required("employer")
    def job_applications(job_id):
        job = employer_job_or_403(job_id)
        applications = query_all(
            """
            SELECT applications.*, users.name AS applicant_name, users.email AS applicant_email
            FROM applications
            JOIN users ON users.id = applications.applicant_id
            WHERE applications.job_id = ?
            ORDER BY applications.created_at DESC
            """,
            (job_id,),
        )
        return render_template("applications.html", job=job, applications=applications)

    @app.route("/applications/<int:application_id>/resume")
    @login_required
    def download_resume(application_id):
        application = application_for_current_user_or_403(application_id)
        stored_name = Path(application["resume_filename"]).name
        upload_path = (UPLOAD_DIR / stored_name).resolve()
        if not upload_path.is_file() or UPLOAD_DIR not in upload_path.parents:
            abort(404)
        download_name = secure_filename(application["resume_original_name"]) or "resume"
        return send_from_directory(
            UPLOAD_DIR,
            stored_name,
            as_attachment=True,
            download_name=download_name,
            mimetype=resume_mimetype(application["resume_type"]),
        )

    return app


def require_secret_key():
    secret = os.environ.get("SECRET_KEY")
    if not secret or len(secret) < 32:
        raise RuntimeError("Set SECRET_KEY to a random value of at least 32 characters.")
    return secret


def parse_bool(value):
    return str(value).strip().lower() in {"1", "true", "yes", "on"}


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return query_one("SELECT id, name, email, role FROM users WHERE id = ?", (user_id,))


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not current_user():
            flash("Sign in to continue.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def role_required(role):
    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            user = current_user()
            if not user or user["role"] != role:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def verify_csrf():
    token = request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if not token or not secrets.compare_digest(token, expected):
        abort(403)


def clean_text(value, max_length):
    value = (value or "").strip()
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    value = re.sub(r"\s+", " ", value)
    return value[:max_length]


def clean_multiline(value, max_length):
    value = (value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value)
    value = re.sub(r"\n{4,}", "\n\n\n", value)
    return value[:max_length]


def normalize_email(value):
    value = clean_text(value, 254).lower()
    if not re.fullmatch(r"[^@\s]{1,64}@[^@\s]{1,180}\.[^@\s]{2,20}", value):
        return ""
    return value


def save_validated_resume(file_storage):
    original_name = secure_filename(file_storage.filename or "")
    extension = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
    if extension not in ALLOWED_EXTENSIONS:
        return None, "Resume must be a PDF, DOCX, or TXT file."

    content = file_storage.stream.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        return None, "Resume is too large."
    if not content:
        return None, "Resume file is empty."

    kind = inspect_resume_content(content, extension)
    if not kind:
        return None, "Resume file contents do not match an allowed file type."

    stored_name = f"{uuid.uuid4().hex}.{kind}"
    target = (UPLOAD_DIR / stored_name).resolve()
    if UPLOAD_DIR not in target.parents:
        return None, "Invalid upload path."
    with target.open("wb") as handle:
        handle.write(content)
    return {"stored_name": stored_name, "original_name": original_name, "kind": kind}, None


def inspect_resume_content(content, extension):
    if extension == "pdf" and content.startswith(b"%PDF-"):
        return "pdf"
    if extension == "txt":
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            return None
        if "\x00" in text:
            return None
        return "txt"
    if extension == "docx" and content.startswith(b"PK"):
        try:
            from io import BytesIO

            with zipfile.ZipFile(BytesIO(content)) as archive:
                names = set(archive.namelist())
                if "[Content_Types].xml" in names and "word/document.xml" in names:
                    return "docx"
        except zipfile.BadZipFile:
            return None
    return None


def resume_mimetype(kind):
    return {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain; charset=utf-8",
    }.get(kind, "application/octet-stream")


def employer_job_or_403(job_id):
    job = query_one("SELECT * FROM jobs WHERE id = ?", (job_id,))
    if not job:
        abort(404)
    if job["employer_id"] != current_user()["id"]:
        abort(403)
    return job


def application_for_current_user_or_403(application_id):
    application = query_one(
        """
        SELECT applications.*, jobs.employer_id
        FROM applications
        JOIN jobs ON jobs.id = applications.job_id
        WHERE applications.id = ?
        """,
        (application_id,),
    )
    if not application:
        abort(404)
    user = current_user()
    if user["role"] == "employer" and application["employer_id"] == user["id"]:
        return application
    if user["role"] == "applicant" and application["applicant_id"] == user["id"]:
        return application
    abort(403)


def query_one(sql, params=()):
    return g.db.execute(sql, params).fetchone()


def query_all(sql, params=()):
    return g.db.execute(sql, params).fetchall()


def execute(sql, params=()):
    cursor = g.db.execute(sql, params)
    g.db.commit()
    return cursor


def ensure_schema(db):
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('employer', 'applicant')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            employer_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            company TEXT NOT NULL,
            location TEXT NOT NULL,
            description TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            FOREIGN KEY (employer_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS applications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_id INTEGER NOT NULL,
            applicant_id INTEGER NOT NULL,
            cover_letter TEXT NOT NULL,
            resume_filename TEXT NOT NULL,
            resume_original_name TEXT NOT NULL,
            resume_type TEXT NOT NULL CHECK (resume_type IN ('pdf', 'docx', 'txt')),
            created_at TEXT NOT NULL,
            UNIQUE (job_id, applicant_id),
            FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
            FOREIGN KEY (applicant_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5070, debug=False)
