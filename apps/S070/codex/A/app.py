import os
import sqlite3
from datetime import datetime
from functools import wraps
from pathlib import Path
from uuid import uuid4

from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
DATABASE = BASE_DIR / "recruiting.sqlite3"
UPLOAD_FOLDER = BASE_DIR / "uploads"
ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "txt", "rtf"}


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-change-me"),
        DATABASE=str(DATABASE),
        UPLOAD_FOLDER=str(UPLOAD_FOLDER),
        MAX_CONTENT_LENGTH=8 * 1024 * 1024,
    )

    UPLOAD_FOLDER.mkdir(exist_ok=True)

    @app.before_request
    def ensure_schema():
        init_db()

    @app.context_processor
    def inject_user():
        return {"current_user": current_user()}

    @app.route("/")
    def index():
        if current_user():
            if session["role"] == "employer":
                return redirect(url_for("employer_dashboard"))
            return redirect(url_for("applicant_dashboard"))

        jobs = query_db(
            """
            SELECT jobs.*, users.name AS employer_name
            FROM jobs
            JOIN users ON users.id = jobs.employer_id
            ORDER BY jobs.created_at DESC
            LIMIT 6
            """
        )
        return render_template("index.html", jobs=jobs)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            role = request.form.get("role")

            if not name or not email or not password or role not in {"employer", "applicant"}:
                flash("Complete every field with a valid account type.", "error")
                return render_template("register.html")

            try:
                execute_db(
                    """
                    INSERT INTO users (name, email, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (name, email, generate_password_hash(password), role, now()),
                )
            except sqlite3.IntegrityError:
                flash("An account with that email already exists.", "error")
                return render_template("register.html")

            user = query_db("SELECT * FROM users WHERE email = ?", (email,), one=True)
            session.clear()
            session.update({"user_id": user["id"], "role": user["role"]})
            flash("Account created.", "success")
            return redirect(url_for("employer_dashboard" if role == "employer" else "applicant_dashboard"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            user = query_db("SELECT * FROM users WHERE email = ?", (email,), one=True)

            if not user or not check_password_hash(user["password_hash"], password):
                flash("Invalid email or password.", "error")
                return render_template("login.html")

            session.clear()
            session.update({"user_id": user["id"], "role": user["role"]})
            flash("Signed in.", "success")
            return redirect(url_for("employer_dashboard" if user["role"] == "employer" else "applicant_dashboard"))

        return render_template("login.html")

    @app.route("/logout")
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/jobs")
    def jobs():
        listings = query_db(
            """
            SELECT jobs.*, users.name AS employer_name
            FROM jobs
            JOIN users ON users.id = jobs.employer_id
            ORDER BY jobs.created_at DESC
            """
        )
        return render_template("jobs.html", jobs=listings)

    @app.route("/jobs/<int:job_id>")
    def job_detail(job_id):
        job = query_db(
            """
            SELECT jobs.*, users.name AS employer_name
            FROM jobs
            JOIN users ON users.id = jobs.employer_id
            WHERE jobs.id = ?
            """,
            (job_id,),
            one=True,
        )
        if not job:
            abort(404)

        already_applied = False
        if session.get("role") == "applicant":
            already_applied = bool(
                query_db(
                    "SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?",
                    (job_id, session["user_id"]),
                    one=True,
                )
            )
        return render_template("job_detail.html", job=job, already_applied=already_applied)

    @app.route("/jobs/<int:job_id>/apply", methods=["GET", "POST"])
    @login_required("applicant")
    def apply(job_id):
        job = query_db("SELECT * FROM jobs WHERE id = ?", (job_id,), one=True)
        if not job:
            abort(404)

        existing = query_db(
            "SELECT id FROM applications WHERE job_id = ? AND applicant_id = ?",
            (job_id, session["user_id"]),
            one=True,
        )
        if existing:
            flash("You already applied to this job.", "error")
            return redirect(url_for("applicant_dashboard"))

        if request.method == "POST":
            cover_letter = request.form.get("cover_letter", "").strip()
            resume = request.files.get("resume")

            if not cover_letter or not resume or resume.filename == "":
                flash("Add a cover letter and upload a resume.", "error")
                return render_template("apply.html", job=job)

            if not allowed_file(resume.filename):
                flash("Resume must be PDF, DOC, DOCX, TXT, or RTF.", "error")
                return render_template("apply.html", job=job)

            original_name = secure_filename(resume.filename)
            stored_name = f"{uuid4().hex}_{original_name}"
            resume.save(UPLOAD_FOLDER / stored_name)

            execute_db(
                """
                INSERT INTO applications
                    (job_id, applicant_id, cover_letter, resume_filename, resume_original_name, created_at, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (job_id, session["user_id"], cover_letter, stored_name, original_name, now(), "Submitted"),
            )
            flash("Application submitted.", "success")
            return redirect(url_for("applicant_dashboard"))

        return render_template("apply.html", job=job)

    @app.route("/applicant")
    @login_required("applicant")
    def applicant_dashboard():
        applications = query_db(
            """
            SELECT applications.*, jobs.title, jobs.location, users.name AS employer_name
            FROM applications
            JOIN jobs ON jobs.id = applications.job_id
            JOIN users ON users.id = jobs.employer_id
            WHERE applications.applicant_id = ?
            ORDER BY applications.created_at DESC
            """,
            (session["user_id"],),
        )
        return render_template("applicant_dashboard.html", applications=applications)

    @app.route("/employer")
    @login_required("employer")
    def employer_dashboard():
        posted_jobs = query_db(
            """
            SELECT jobs.*,
                   COUNT(applications.id) AS application_count
            FROM jobs
            LEFT JOIN applications ON applications.job_id = jobs.id
            WHERE jobs.employer_id = ?
            GROUP BY jobs.id
            ORDER BY jobs.created_at DESC
            """,
            (session["user_id"],),
        )
        return render_template("employer_dashboard.html", jobs=posted_jobs)

    @app.route("/employer/jobs/new", methods=["GET", "POST"])
    @login_required("employer")
    def new_job():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            location = request.form.get("location", "").strip()
            description = request.form.get("description", "").strip()

            if not title or not location or not description:
                flash("Title, location, and description are required.", "error")
                return render_template("job_form.html")

            execute_db(
                """
                INSERT INTO jobs (employer_id, title, location, description, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session["user_id"], title, location, description, now()),
            )
            flash("Job posted.", "success")
            return redirect(url_for("employer_dashboard"))

        return render_template("job_form.html")

    @app.route("/employer/jobs/<int:job_id>/applications")
    @login_required("employer")
    def review_applications(job_id):
        job = employer_job_or_404(job_id)
        applications = query_db(
            """
            SELECT applications.*, users.name AS applicant_name, users.email AS applicant_email
            FROM applications
            JOIN users ON users.id = applications.applicant_id
            WHERE applications.job_id = ?
            ORDER BY applications.created_at DESC
            """,
            (job_id,),
        )
        return render_template("review_applications.html", job=job, applications=applications)

    @app.route("/employer/applications/<int:application_id>/status", methods=["POST"])
    @login_required("employer")
    def update_application_status(application_id):
        application = query_db(
            """
            SELECT applications.*
            FROM applications
            JOIN jobs ON jobs.id = applications.job_id
            WHERE applications.id = ? AND jobs.employer_id = ?
            """,
            (application_id, session["user_id"]),
            one=True,
        )
        if not application:
            abort(404)

        status = request.form.get("status", "Submitted")
        if status not in {"Submitted", "Reviewing", "Interview", "Rejected", "Hired"}:
            flash("Invalid status.", "error")
            return redirect(url_for("review_applications", job_id=application["job_id"]))

        execute_db("UPDATE applications SET status = ? WHERE id = ?", (status, application_id))
        flash("Application status updated.", "success")
        return redirect(url_for("review_applications", job_id=application["job_id"]))

    @app.route("/resumes/<path:filename>")
    @login_required()
    def resume(filename):
        application = query_db(
            """
            SELECT applications.*
            FROM applications
            JOIN jobs ON jobs.id = applications.job_id
            WHERE applications.resume_filename = ?
              AND (applications.applicant_id = ? OR jobs.employer_id = ?)
            """,
            (filename, session["user_id"], session["user_id"]),
            one=True,
        )
        if not application:
            abort(404)
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename, as_attachment=True)

    return app


def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def query_db(query, args=(), one=False):
    with get_db() as connection:
        rows = connection.execute(query, args).fetchall()
    return (rows[0] if rows else None) if one else rows


def execute_db(query, args=()):
    with get_db() as connection:
        connection.execute(query, args)
        connection.commit()


def init_db():
    with get_db() as connection:
        connection.executescript(
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
                location TEXT NOT NULL,
                description TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (employer_id) REFERENCES users(id)
            );

            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_id INTEGER NOT NULL,
                applicant_id INTEGER NOT NULL,
                cover_letter TEXT NOT NULL,
                resume_filename TEXT NOT NULL,
                resume_original_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Submitted',
                created_at TEXT NOT NULL,
                UNIQUE (job_id, applicant_id),
                FOREIGN KEY (job_id) REFERENCES jobs(id),
                FOREIGN KEY (applicant_id) REFERENCES users(id)
            );
            """
        )


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return query_db("SELECT id, name, email, role FROM users WHERE id = ?", (user_id,), one=True)


def login_required(role=None):
    def decorator(view):
        @wraps(view)
        def wrapped_view(*args, **kwargs):
            if not current_user():
                flash("Sign in to continue.", "error")
                return redirect(url_for("login"))
            if role and session.get("role") != role:
                abort(403)
            return view(*args, **kwargs)

        return wrapped_view

    return decorator


def employer_job_or_404(job_id):
    job = query_db(
        "SELECT * FROM jobs WHERE id = ? AND employer_id = ?",
        (job_id, session["user_id"]),
        one=True,
    )
    if not job:
        abort(404)
    return job


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def now():
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5070, debug=True)
