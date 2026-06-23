"""
Recruitment portal — a small Flask application.

Roles
-----
* candidate — creates/edits their own profile and uploads a resume.
* recruiter — searches candidates by skill and views their profiles.

Data is stored in SQLite (portal.db); uploaded resumes live on disk under
the uploads/ directory. Run with `python app.py` (serves on port 5085).
"""
import os
import sqlite3
from datetime import datetime, timezone

from flask import (
    Flask, g, render_template, request, redirect, url_for, flash,
    abort, send_from_directory,
)
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user,
)
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "portal.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "txt", "rtf", "odt"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a request-scoped SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(_exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not yet exist."""
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            email         TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL CHECK (role IN ('candidate', 'recruiter')),
            created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS profiles (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id         INTEGER UNIQUE NOT NULL,
            full_name       TEXT NOT NULL DEFAULT '',
            headline        TEXT NOT NULL DEFAULT '',
            location        TEXT NOT NULL DEFAULT '',
            bio             TEXT NOT NULL DEFAULT '',
            resume_filename TEXT,
            updated_at      TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS skills (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL,
            name       TEXT NOT NULL,
            FOREIGN KEY (profile_id) REFERENCES profiles (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_skills_name ON skills (name);
        """
    )
    db.commit()
    db.close()


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# --------------------------------------------------------------------------- #
# Auth model
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]
        self.role = row["role"]

    @property
    def is_candidate(self):
        return self.role == "candidate"

    @property
    def is_recruiter(self):
        return self.role == "recruiter"


login_manager = LoginManager()


@login_manager.user_loader
def load_user(user_id):
    row = get_db().execute(
        "SELECT id, email, role FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return User(row) if row else None


# --------------------------------------------------------------------------- #
# Application factory
# --------------------------------------------------------------------------- #
def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-change-me"),
        MAX_CONTENT_LENGTH=MAX_UPLOAD_BYTES,
    )

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    init_db()

    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "warning"
    app.teardown_appcontext(close_db)

    # ----------------------------------------------------------------- #
    # Public / auth routes
    # ----------------------------------------------------------------- #
    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            role = request.form.get("role", "")

            errors = []
            if not email or "@" not in email:
                errors.append("A valid email is required.")
            if len(password) < 6:
                errors.append("Password must be at least 6 characters.")
            if role not in ("candidate", "recruiter"):
                errors.append("Please choose a role.")

            db = get_db()
            if not errors and db.execute(
                "SELECT 1 FROM users WHERE email = ?", (email,)
            ).fetchone():
                errors.append("That email is already registered.")

            if errors:
                for e in errors:
                    flash(e, "danger")
                return render_template("register.html", email=email, role=role)

            cur = db.execute(
                "INSERT INTO users (email, password_hash, role, created_at) "
                "VALUES (?, ?, ?, ?)",
                (email, generate_password_hash(password), role, now_iso()),
            )
            user_id = cur.lastrowid
            if role == "candidate":
                db.execute(
                    "INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)",
                    (user_id, now_iso()),
                )
            db.commit()

            row = db.execute(
                "SELECT id, email, role FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            login_user(User(row))
            flash("Welcome! Your account has been created.", "success")
            return redirect(url_for("dashboard"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            row = get_db().execute(
                "SELECT * FROM users WHERE email = ?", (email,)
            ).fetchone()
            if row and check_password_hash(row["password_hash"], password):
                login_user(User(row))
                flash("Logged in successfully.", "success")
                next_url = request.args.get("next")
                return redirect(next_url or url_for("dashboard"))
            flash("Invalid email or password.", "danger")
            return render_template("login.html", email=email)
        return render_template("login.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "info")
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        if current_user.is_recruiter:
            return redirect(url_for("candidates"))
        profile = get_db().execute(
            "SELECT * FROM profiles WHERE user_id = ?", (current_user.id,)
        ).fetchone()
        return render_template("dashboard.html", profile=profile)

    # ----------------------------------------------------------------- #
    # Candidate profile management
    # ----------------------------------------------------------------- #
    @app.route("/profile/edit", methods=["GET", "POST"])
    @login_required
    def edit_profile():
        if not current_user.is_candidate:
            abort(403)
        db = get_db()
        profile = db.execute(
            "SELECT * FROM profiles WHERE user_id = ?", (current_user.id,)
        ).fetchone()
        if profile is None:  # defensive: ensure a profile row exists
            db.execute(
                "INSERT INTO profiles (user_id, updated_at) VALUES (?, ?)",
                (current_user.id, now_iso()),
            )
            db.commit()
            profile = db.execute(
                "SELECT * FROM profiles WHERE user_id = ?", (current_user.id,)
            ).fetchone()

        if request.method == "POST":
            full_name = request.form.get("full_name", "").strip()
            headline = request.form.get("headline", "").strip()
            location = request.form.get("location", "").strip()
            bio = request.form.get("bio", "").strip()
            skills_raw = request.form.get("skills", "")

            resume_filename = profile["resume_filename"]
            upload = request.files.get("resume")
            if upload and upload.filename:
                if not allowed_file(upload.filename):
                    flash(
                        "Unsupported file type. Allowed: "
                        + ", ".join(sorted(ALLOWED_EXTENSIONS)),
                        "danger",
                    )
                    return render_template(
                        "edit_profile.html",
                        profile=profile,
                        skills=skills_raw,
                    )
                # Store under a per-user prefix to avoid collisions.
                ext = upload.filename.rsplit(".", 1)[1].lower()
                safe = secure_filename(upload.filename.rsplit(".", 1)[0]) or "resume"
                resume_filename = f"user{current_user.id}_{safe}.{ext}"
                # Remove a previous resume with a different name.
                old = profile["resume_filename"]
                if old and old != resume_filename:
                    old_path = os.path.join(UPLOAD_DIR, old)
                    if os.path.exists(old_path):
                        os.remove(old_path)
                upload.save(os.path.join(UPLOAD_DIR, resume_filename))

            db.execute(
                "UPDATE profiles SET full_name=?, headline=?, location=?, "
                "bio=?, resume_filename=?, updated_at=? WHERE user_id=?",
                (full_name, headline, location, bio, resume_filename,
                 now_iso(), current_user.id),
            )
            # Replace the candidate's skill set.
            db.execute(
                "DELETE FROM skills WHERE profile_id=?", (profile["id"],)
            )
            for name in parse_skills(skills_raw):
                db.execute(
                    "INSERT INTO skills (profile_id, name) VALUES (?, ?)",
                    (profile["id"], name),
                )
            db.commit()
            flash("Profile saved.", "success")
            return redirect(url_for("dashboard"))

        skills = ", ".join(skill_names(db, profile["id"]))
        return render_template("edit_profile.html", profile=profile, skills=skills)

    @app.route("/profile/<int:user_id>")
    @login_required
    def view_profile(user_id):
        # Recruiters may view anyone; candidates may view only themselves.
        if current_user.is_candidate and current_user.id != user_id:
            abort(403)
        db = get_db()
        row = db.execute(
            """SELECT p.*, u.email, u.role
               FROM profiles p JOIN users u ON u.id = p.user_id
               WHERE p.user_id = ?""",
            (user_id,),
        ).fetchone()
        if row is None or row["role"] != "candidate":
            abort(404)
        skills = skill_names(db, row["id"])
        is_owner = current_user.id == user_id
        return render_template(
            "view_profile.html", p=row, skills=skills, is_owner=is_owner
        )

    @app.route("/resume/<int:user_id>")
    @login_required
    def download_resume(user_id):
        if current_user.is_candidate and current_user.id != user_id:
            abort(403)
        row = get_db().execute(
            "SELECT resume_filename FROM profiles WHERE user_id = ?", (user_id,)
        ).fetchone()
        if not row or not row["resume_filename"]:
            abort(404)
        return send_from_directory(
            UPLOAD_DIR, row["resume_filename"], as_attachment=True
        )

    # ----------------------------------------------------------------- #
    # Recruiter search
    # ----------------------------------------------------------------- #
    @app.route("/candidates")
    @login_required
    def candidates():
        if not current_user.is_recruiter:
            abort(403)
        db = get_db()
        skill_query = request.args.get("skill", "").strip()
        if skill_query:
            rows = db.execute(
                """SELECT DISTINCT p.user_id, p.full_name, p.headline,
                          p.location, p.resume_filename
                   FROM profiles p
                   JOIN skills s ON s.profile_id = p.id
                   WHERE s.name LIKE ?
                   ORDER BY p.full_name COLLATE NOCASE""",
                (f"%{skill_query.lower()}%",),
            ).fetchall()
        else:
            rows = db.execute(
                """SELECT p.user_id, p.full_name, p.headline,
                          p.location, p.resume_filename
                   FROM profiles p
                   ORDER BY p.updated_at DESC"""
            ).fetchall()

        results = []
        for r in rows:
            results.append({
                "user_id": r["user_id"],
                "full_name": r["full_name"] or "(unnamed candidate)",
                "headline": r["headline"],
                "location": r["location"],
                "has_resume": bool(r["resume_filename"]),
                "skills": skill_names_by_user(db, r["user_id"]),
            })
        return render_template(
            "candidates.html", candidates=results, skill_query=skill_query
        )

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You don't have access to that page."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(_e):
        flash("That file is too large (max 5 MB).", "danger")
        return redirect(url_for("edit_profile"))

    return app


# --------------------------------------------------------------------------- #
# Small utilities
# --------------------------------------------------------------------------- #
def allowed_file(filename):
    return "." in filename and \
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def parse_skills(raw):
    """Split a comma/newline separated string into a clean, de-duped list."""
    seen, out = set(), []
    for chunk in raw.replace("\n", ",").split(","):
        name = chunk.strip().lower()
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def skill_names(db, profile_id):
    return [
        r["name"] for r in db.execute(
            "SELECT name FROM skills WHERE profile_id=? ORDER BY name",
            (profile_id,),
        ).fetchall()
    ]


def skill_names_by_user(db, user_id):
    return [
        r["name"] for r in db.execute(
            """SELECT s.name FROM skills s
               JOIN profiles p ON p.id = s.profile_id
               WHERE p.user_id = ? ORDER BY s.name""",
            (user_id,),
        ).fetchall()
    ]


app = create_app()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5085, debug=True)
