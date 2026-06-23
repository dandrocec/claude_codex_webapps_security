"""Recruiting application — Flask + SQLite.

Roles:
  * employer  — posts jobs, reviews applications for *their own* jobs.
  * applicant — applies to jobs and uploads a resume, sees *their own*
                submissions only.

Security posture (OWASP Top 10):
  * A01 Access control  — every resource access is scoped to the current
        user (ownership checks on jobs, applications and resume downloads),
        defeating IDOR.
  * A02 Crypto failures — passwords hashed with Argon2id (salted, strong).
  * A03 Injection       — all SQL uses bound parameters; Jinja2 auto-escapes
        output (context-aware encoding) to prevent XSS.
  * A05 Misconfig       — strict security headers, no debug, secrets from env.
  * A07 Auth            — Flask-Login session management, hardened cookies.
  * CSRF                — Flask-WTF protects all state-changing POSTs.
  * Errors              — custom handlers; stack traces never reach clients.
"""
import os
import secrets as _secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    send_file,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

import db as database
from config import Config
from forms import (
    ApplicationForm,
    JobForm,
    LoginForm,
    RegisterForm,
    StatusForm,
)
from uploads import resolve_stored_path, save_resume

ph = PasswordHasher()  # Argon2id with sane defaults.
csrf = CSRFProtect()
login_manager = LoginManager()


# --------------------------------------------------------------------------
# User model for Flask-Login
# --------------------------------------------------------------------------
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.email = row["email"]
        self.role = row["role"]
        self.full_name = row["full_name"]

    @property
    def is_employer(self) -> bool:
        return self.role == "employer"

    @property
    def is_applicant(self) -> bool:
        return self.role == "applicant"


@login_manager.user_loader
def load_user(user_id: str):
    db = database.get_db()
    row = db.execute(
        "SELECT id, email, role, full_name FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return User(row) if row else None


# --------------------------------------------------------------------------
# Application factory
# --------------------------------------------------------------------------
def create_app(config_object=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    database.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.session_protection = "strong"

    os.makedirs(app.config["UPLOAD_DIR"], exist_ok=True)

    with app.app_context():
        database.init_db()

    _register_routes(app)
    _register_security(app)
    _register_error_handlers(app)
    return app


# --------------------------------------------------------------------------
# Security headers
# --------------------------------------------------------------------------
def _register_security(app: Flask) -> None:
    @app.after_request
    def set_security_headers(resp):
        # Strict CSP: only same-origin resources, no inline JS.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


# --------------------------------------------------------------------------
# Error handlers — never leak internals
# --------------------------------------------------------------------------
def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(400)
    def bad_request(e):
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403,
                               message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404, message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(e):
        return render_template("error.html", code=413,
                               message="The uploaded file is too large."), 413

    @app.errorhandler(CSRFError)
    def csrf_error(e):
        return render_template("error.html", code=400,
                               message="The form expired or was invalid. Please retry."), 400

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="An internal error occurred."), 500


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
def _register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        db = database.get_db()
        jobs = db.execute(
            """SELECT j.id, j.title, j.location, j.created_at, u.full_name AS employer
               FROM jobs j JOIN users u ON u.id = j.employer_id
               ORDER BY j.created_at DESC"""
        ).fetchall()
        return render_template("index.html", jobs=jobs)

    # ---- Auth ------------------------------------------------------------
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        form = RegisterForm()
        if form.validate_on_submit():
            db = database.get_db()
            email = form.email.data.strip().lower()
            existing = db.execute(
                "SELECT id FROM users WHERE email = ?", (email,)
            ).fetchone()
            if existing:
                # Generic message; do not reveal which field caused failure
                # in a way that aids enumeration beyond what registration
                # inevitably exposes.
                flash("Could not create the account with those details.", "error")
                return render_template("register.html", form=form)

            pw_hash = ph.hash(form.password.data)
            db.execute(
                """INSERT INTO users (email, password_hash, role, full_name)
                   VALUES (?, ?, ?, ?)""",
                (email, pw_hash, form.role.data, form.full_name.data.strip()),
            )
            db.commit()
            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        form = LoginForm()
        if form.validate_on_submit():
            db = database.get_db()
            email = form.email.data.strip().lower()
            row = db.execute(
                "SELECT id, email, role, full_name, password_hash FROM users WHERE email = ?",
                (email,),
            ).fetchone()

            # Always run a verification to keep timing roughly constant and
            # avoid user-enumeration via response time.
            valid = False
            if row is not None:
                try:
                    ph.verify(row["password_hash"], form.password.data)
                    valid = True
                    # Transparently upgrade the hash if parameters changed.
                    if ph.check_needs_rehash(row["password_hash"]):
                        new_hash = ph.hash(form.password.data)
                        db.execute(
                            "UPDATE users SET password_hash = ? WHERE id = ?",
                            (new_hash, row["id"]),
                        )
                        db.commit()
                except (VerifyMismatchError, VerificationError, InvalidHashError):
                    valid = False
            else:
                # Dummy verify to equalise timing.
                try:
                    ph.verify(
                        "$argon2id$v=19$m=65536,t=3,p=4$"
                        "c29tZXNhbHRzb21lc2FsdA$"
                        "c29tZWhhc2hzb21laGFzaHNvbWVoYXNoc29t",
                        form.password.data,
                    )
                except Exception:
                    pass

            if valid:
                login_user(User(row))
                flash("Logged in.", "success")
                nxt = request.args.get("next")
                # Open-redirect guard: only allow local relative targets.
                if nxt and nxt.startswith("/") and not nxt.startswith("//"):
                    return redirect(nxt)
                return redirect(url_for("dashboard"))
            flash("Invalid email or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    # ---- Dashboard -------------------------------------------------------
    @app.route("/dashboard")
    @login_required
    def dashboard():
        db = database.get_db()
        if current_user.is_employer:
            jobs = db.execute(
                """SELECT j.id, j.title, j.location, j.created_at,
                          (SELECT COUNT(*) FROM applications a WHERE a.job_id = j.id) AS app_count
                   FROM jobs j WHERE j.employer_id = ?
                   ORDER BY j.created_at DESC""",
                (current_user.id,),
            ).fetchall()
            return render_template("dashboard_employer.html", jobs=jobs)
        else:
            apps = db.execute(
                """SELECT a.id, a.status, a.created_at, a.resume_ext,
                          j.title, j.location, u.full_name AS employer
                   FROM applications a
                   JOIN jobs j ON j.id = a.job_id
                   JOIN users u ON u.id = j.employer_id
                   WHERE a.applicant_id = ?
                   ORDER BY a.created_at DESC""",
                (current_user.id,),
            ).fetchall()
            return render_template("dashboard_applicant.html", applications=apps)

    # ---- Jobs ------------------------------------------------------------
    @app.route("/jobs/new", methods=["GET", "POST"])
    @login_required
    def new_job():
        if not current_user.is_employer:
            abort(403)
        form = JobForm()
        if form.validate_on_submit():
            db = database.get_db()
            cur = db.execute(
                """INSERT INTO jobs (employer_id, title, location, description)
                   VALUES (?, ?, ?, ?)""",
                (
                    current_user.id,
                    form.title.data.strip(),
                    form.location.data.strip(),
                    form.description.data.strip(),
                ),
            )
            db.commit()
            flash("Job posted.", "success")
            return redirect(url_for("job_detail", job_id=cur.lastrowid))
        return render_template("new_job.html", form=form)

    @app.route("/jobs/<int:job_id>")
    def job_detail(job_id: int):
        db = database.get_db()
        job = db.execute(
            """SELECT j.id, j.title, j.location, j.description, j.created_at,
                      j.employer_id, u.full_name AS employer
               FROM jobs j JOIN users u ON u.id = j.employer_id
               WHERE j.id = ?""",
            (job_id,),
        ).fetchone()
        if job is None:
            abort(404)

        already_applied = False
        if current_user.is_authenticated and current_user.is_applicant:
            already_applied = db.execute(
                "SELECT 1 FROM applications WHERE job_id = ? AND applicant_id = ?",
                (job_id, current_user.id),
            ).fetchone() is not None

        return render_template(
            "job_detail.html", job=job, already_applied=already_applied
        )

    @app.route("/jobs/<int:job_id>/applications")
    @login_required
    def job_applications(job_id: int):
        db = database.get_db()
        job = db.execute(
            "SELECT id, title, employer_id FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if job is None:
            abort(404)
        # Access control: only the owning employer may view applications.
        if not current_user.is_employer or job["employer_id"] != current_user.id:
            abort(403)

        apps = db.execute(
            """SELECT a.id, a.cover_letter, a.status, a.created_at, a.resume_ext,
                      u.full_name AS applicant, u.email AS applicant_email
               FROM applications a JOIN users u ON u.id = a.applicant_id
               WHERE a.job_id = ?
               ORDER BY a.created_at DESC""",
            (job_id,),
        ).fetchall()
        status_form = StatusForm()
        return render_template(
            "job_applications.html", job=job, applications=apps, status_form=status_form
        )

    # ---- Applications ----------------------------------------------------
    @app.route("/jobs/<int:job_id>/apply", methods=["GET", "POST"])
    @login_required
    def apply(job_id: int):
        if not current_user.is_applicant:
            abort(403)
        db = database.get_db()
        job = db.execute(
            "SELECT id, title FROM jobs WHERE id = ?", (job_id,)
        ).fetchone()
        if job is None:
            abort(404)

        form = ApplicationForm()
        if form.validate_on_submit():
            # Reject duplicate applications.
            dup = db.execute(
                "SELECT 1 FROM applications WHERE job_id = ? AND applicant_id = ?",
                (job_id, current_user.id),
            ).fetchone()
            if dup:
                flash("You have already applied to this job.", "error")
                return redirect(url_for("dashboard"))

            try:
                stored, ext = save_resume(form.resume.data, app.config["UPLOAD_DIR"])
            except ValueError as exc:
                flash(str(exc), "error")
                return render_template("apply.html", form=form, job=job)

            db.execute(
                """INSERT INTO applications
                       (job_id, applicant_id, cover_letter, resume_stored, resume_ext)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    job_id,
                    current_user.id,
                    (form.cover_letter.data or "").strip(),
                    stored,
                    ext,
                ),
            )
            db.commit()
            flash("Application submitted.", "success")
            return redirect(url_for("dashboard"))
        return render_template("apply.html", form=form, job=job)

    @app.route("/applications/<int:app_id>/status", methods=["POST"])
    @login_required
    def update_status(app_id: int):
        db = database.get_db()
        row = db.execute(
            """SELECT a.id, a.job_id, j.employer_id
               FROM applications a JOIN jobs j ON j.id = a.job_id
               WHERE a.id = ?""",
            (app_id,),
        ).fetchone()
        if row is None:
            abort(404)
        # Only the employer who owns the job may change status.
        if not current_user.is_employer or row["employer_id"] != current_user.id:
            abort(403)

        form = StatusForm()
        if form.validate_on_submit():
            db.execute(
                "UPDATE applications SET status = ? WHERE id = ?",
                (form.status.data, app_id),
            )
            db.commit()
            flash("Status updated.", "success")
        else:
            flash("Invalid status update.", "error")
        return redirect(url_for("job_applications", job_id=row["job_id"]))

    @app.route("/applications/<int:app_id>/resume")
    @login_required
    def download_resume(app_id: int):
        db = database.get_db()
        row = db.execute(
            """SELECT a.id, a.applicant_id, a.resume_stored, a.resume_ext,
                      j.employer_id
               FROM applications a JOIN jobs j ON j.id = a.job_id
               WHERE a.id = ?""",
            (app_id,),
        ).fetchone()
        if row is None:
            abort(404)

        # Access control: the owning applicant OR the employer who owns the
        # job may download. Everyone else is forbidden (prevents IDOR).
        is_owner_applicant = (
            current_user.is_applicant and row["applicant_id"] == current_user.id
        )
        is_owner_employer = (
            current_user.is_employer and row["employer_id"] == current_user.id
        )
        if not (is_owner_applicant or is_owner_employer):
            abort(403)

        # Resolve safely from our stored (random) name; re-validate path.
        path = resolve_stored_path(row["resume_stored"], app.config["UPLOAD_DIR"])
        if path is None:
            abort(404)

        download_name = f"resume-{app_id}.{row['resume_ext']}"
        mimetypes = {
            "pdf": "application/pdf",
            "doc": "application/msword",
            "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }
        return send_file(
            path,
            mimetype=mimetypes.get(row["resume_ext"], "application/octet-stream"),
            as_attachment=True,  # force download, never inline render
            download_name=download_name,
        )


# Module-level app for `flask run` / WSGI servers.
app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5070))
    # Debug is forced off so tracebacks are never exposed.
    app.run(host="127.0.0.1", port=port, debug=False)
