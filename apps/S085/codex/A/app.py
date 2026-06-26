import os
import sqlite3
import uuid
from datetime import datetime
from functools import wraps

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
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
INSTANCE_DIR = os.path.join(BASE_DIR, "instance")
DATABASE = os.path.join(INSTANCE_DIR, "recruitment.db")
RESUME_DIR = os.path.join(INSTANCE_DIR, "resumes")
ALLOWED_RESUME_EXTENSIONS = {"pdf", "doc", "docx", "txt", "rtf"}


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = DATABASE
app.config["RESUME_DIR"] = RESUME_DIR
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024


def ensure_instance_dirs():
    os.makedirs(INSTANCE_DIR, exist_ok=True)
    os.makedirs(RESUME_DIR, exist_ok=True)


def get_db():
    if "db" not in g:
        ensure_instance_dirs()
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('candidate', 'recruiter')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS candidate_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            headline TEXT NOT NULL DEFAULT '',
            location TEXT NOT NULL DEFAULT '',
            skills TEXT NOT NULL DEFAULT '',
            experience TEXT NOT NULL DEFAULT '',
            resume_filename TEXT,
            resume_original_name TEXT,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


@app.before_request
def load_logged_in_user():
    init_db()
    user_id = session.get("user_id")
    if user_id is None:
        g.user = None
        return
    g.user = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "warning")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def role_required(role):
    def decorator(view):
        @wraps(view)
        def wrapped_view(**kwargs):
            if g.user is None:
                flash("Please sign in to continue.", "warning")
                return redirect(url_for("login"))
            if g.user["role"] != role:
                abort(403)
            return view(**kwargs)

        return wrapped_view

    return decorator


def allowed_resume(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_RESUME_EXTENSIONS


def save_resume(file_storage):
    original_name = secure_filename(file_storage.filename or "")
    if not original_name or not allowed_resume(original_name):
        raise ValueError("Upload a resume as PDF, DOC, DOCX, TXT, or RTF.")
    extension = original_name.rsplit(".", 1)[1].lower()
    stored_name = f"{uuid.uuid4().hex}.{extension}"
    file_storage.save(os.path.join(app.config["RESUME_DIR"], stored_name))
    return stored_name, original_name


def get_candidate_profile(user_id):
    return (
        get_db()
        .execute(
            """
            SELECT p.*, u.name, u.email
            FROM candidate_profiles p
            JOIN users u ON u.id = p.user_id
            WHERE p.user_id = ?
            """,
            (user_id,),
        )
        .fetchone()
    )


@app.route("/")
def index():
    if g.user and g.user["role"] == "candidate":
        return redirect(url_for("candidate_profile"))
    if g.user and g.user["role"] == "recruiter":
        return redirect(url_for("search_candidates"))
    return render_template("index.html")


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        role = request.form.get("role", "candidate")
        error = None

        if not name:
            error = "Name is required."
        elif not email:
            error = "Email is required."
        elif len(password) < 8:
            error = "Password must be at least 8 characters."
        elif role not in {"candidate", "recruiter"}:
            error = "Choose a valid role."

        if error is None:
            try:
                db = get_db()
                cursor = db.execute(
                    """
                    INSERT INTO users (name, email, password_hash, role, created_at)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        name,
                        email,
                        generate_password_hash(password),
                        role,
                        datetime.utcnow().isoformat(timespec="seconds"),
                    ),
                )
                user_id = cursor.lastrowid
                if role == "candidate":
                    db.execute(
                        """
                        INSERT INTO candidate_profiles (user_id, updated_at)
                        VALUES (?, ?)
                        """,
                        (user_id, datetime.utcnow().isoformat(timespec="seconds")),
                    )
                db.commit()
            except sqlite3.IntegrityError:
                error = "An account with that email already exists."
            else:
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))

        flash(error, "danger")

    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid email or password.", "danger")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash("Signed in successfully.", "success")
            return redirect(url_for("index"))

    return render_template("login.html")


@app.route("/logout", methods=("POST",))
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("index"))


@app.route("/candidate/profile", methods=("GET", "POST"))
@role_required("candidate")
def candidate_profile():
    db = get_db()
    profile = get_candidate_profile(g.user["id"])

    if request.method == "POST":
        headline = request.form.get("headline", "").strip()
        location = request.form.get("location", "").strip()
        skills = request.form.get("skills", "").strip()
        experience = request.form.get("experience", "").strip()
        resume = request.files.get("resume")
        resume_filename = profile["resume_filename"] if profile else None
        resume_original_name = profile["resume_original_name"] if profile else None

        if resume and resume.filename:
            try:
                resume_filename, resume_original_name = save_resume(resume)
            except ValueError as exc:
                flash(str(exc), "danger")
                return redirect(url_for("candidate_profile"))

        db.execute(
            """
            INSERT INTO candidate_profiles
                (user_id, headline, location, skills, experience, resume_filename,
                 resume_original_name, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
                headline = excluded.headline,
                location = excluded.location,
                skills = excluded.skills,
                experience = excluded.experience,
                resume_filename = excluded.resume_filename,
                resume_original_name = excluded.resume_original_name,
                updated_at = excluded.updated_at
            """,
            (
                g.user["id"],
                headline,
                location,
                skills,
                experience,
                resume_filename,
                resume_original_name,
                datetime.utcnow().isoformat(timespec="seconds"),
            ),
        )
        db.commit()
        flash("Profile saved.", "success")
        return redirect(url_for("candidate_profile"))

    return render_template("candidate_profile.html", profile=profile)


@app.route("/recruiter/search")
@role_required("recruiter")
def search_candidates():
    skill = request.args.get("skill", "").strip()
    candidates = []
    if skill:
        candidates = (
            get_db()
            .execute(
                """
                SELECT p.*, u.name, u.email
                FROM candidate_profiles p
                JOIN users u ON u.id = p.user_id
                WHERE lower(p.skills) LIKE ?
                ORDER BY u.name COLLATE NOCASE
                """,
                (f"%{skill.lower()}%",),
            )
            .fetchall()
        )
    else:
        candidates = (
            get_db()
            .execute(
                """
                SELECT p.*, u.name, u.email
                FROM candidate_profiles p
                JOIN users u ON u.id = p.user_id
                ORDER BY p.updated_at DESC
                LIMIT 25
                """
            )
            .fetchall()
        )

    return render_template("search.html", candidates=candidates, skill=skill)


@app.route("/recruiter/candidates/<int:user_id>")
@role_required("recruiter")
def view_candidate(user_id):
    profile = get_candidate_profile(user_id)
    if profile is None:
        abort(404)
    return render_template("view_candidate.html", profile=profile)


@app.route("/resumes/<filename>")
@login_required
def resume_file(filename):
    profile = (
        get_db()
        .execute("SELECT * FROM candidate_profiles WHERE resume_filename = ?", (filename,))
        .fetchone()
    )
    if profile is None:
        abort(404)
    if g.user["role"] != "recruiter" and profile["user_id"] != g.user["id"]:
        abort(403)
    return send_from_directory(app.config["RESUME_DIR"], filename, as_attachment=True)


@app.errorhandler(403)
def forbidden(error):
    return render_template("error.html", title="Forbidden", message="You do not have access to this page."), 403


@app.errorhandler(404)
def not_found(error):
    return render_template("error.html", title="Not found", message="The requested page could not be found."), 404


if __name__ == "__main__":
    ensure_instance_dirs()
    with app.app_context():
        init_db()
    app.run(host="127.0.0.1", port=5085, debug=True)
