import os
import uuid
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

from models import Application, Job, User, db

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "txt", "rtf", "odt"}
MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MB resume cap


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-change-me"),
        SQLALCHEMY_DATABASE_URI="sqlite:///"
        + os.path.join(BASE_DIR, "recruiting.db"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        MAX_CONTENT_LENGTH=MAX_CONTENT_LENGTH,
        UPLOAD_DIR=UPLOAD_DIR,
    )

    db.init_app(app)
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    with app.app_context():
        db.create_all()

    register_routes(app)
    return app


# ----------------------------------------------------------------------------
# Auth helpers
# ----------------------------------------------------------------------------

def load_current_user():
    user_id = session.get("user_id")
    g.user = db.session.get(User, user_id) if user_id else None


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def role_required(role):
    def decorator(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            if g.user is None:
                flash("Please log in to continue.", "error")
                return redirect(url_for("login", next=request.path))
            if g.user.role != role:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def allowed_file(filename):
    return (
        "." in filename
        and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )


# ----------------------------------------------------------------------------
# Routes
# ----------------------------------------------------------------------------

def register_routes(app):
    app.before_request(load_current_user)

    @app.context_processor
    def inject_user():
        return {"current_user": g.get("user")}

    # --- Home / job listings ------------------------------------------------
    @app.route("/")
    def index():
        jobs = Job.query.order_by(Job.created_at.desc()).all()
        return render_template("index.html", jobs=jobs)

    # --- Registration -------------------------------------------------------
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            role = request.form.get("role", "")

            errors = []
            if not name:
                errors.append("Name is required.")
            if not email:
                errors.append("Email is required.")
            if len(password) < 6:
                errors.append("Password must be at least 6 characters.")
            if role not in ("employer", "applicant"):
                errors.append("Please choose a valid role.")
            if email and User.query.filter_by(email=email).first():
                errors.append("An account with that email already exists.")

            if errors:
                for e in errors:
                    flash(e, "error")
                return render_template("register.html", form=request.form)

            user = User(
                name=name,
                email=email,
                password_hash=generate_password_hash(password),
                role=role,
            )
            db.session.add(user)
            db.session.commit()
            session.clear()
            session["user_id"] = user.id
            flash("Welcome, your account has been created.", "success")
            return redirect(url_for("dashboard"))

        return render_template("register.html", form={})

    # --- Login / logout -----------------------------------------------------
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = request.form.get("email", "").strip().lower()
            password = request.form.get("password", "")
            user = User.query.filter_by(email=email).first()
            if user is None or not check_password_hash(user.password_hash, password):
                flash("Invalid email or password.", "error")
                return render_template("login.html", form=request.form)

            session.clear()
            session["user_id"] = user.id
            flash("Logged in successfully.", "success")
            nxt = request.form.get("next") or request.args.get("next")
            if nxt and nxt.startswith("/"):
                return redirect(nxt)
            return redirect(url_for("dashboard"))

        return render_template("login.html", form={})

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("You have been logged out.", "success")
        return redirect(url_for("index"))

    # --- Dashboard ----------------------------------------------------------
    @app.route("/dashboard")
    @login_required
    def dashboard():
        if g.user.is_employer:
            jobs = (
                Job.query.filter_by(employer_id=g.user.id)
                .order_by(Job.created_at.desc())
                .all()
            )
            return render_template("dashboard_employer.html", jobs=jobs)
        else:
            applications = (
                Application.query.filter_by(applicant_id=g.user.id)
                .order_by(Application.created_at.desc())
                .all()
            )
            return render_template(
                "dashboard_applicant.html", applications=applications
            )

    # --- Job detail ---------------------------------------------------------
    @app.route("/jobs/<int:job_id>")
    def job_detail(job_id):
        job = db.get_or_404(Job, job_id)
        already_applied = False
        if g.user and g.user.is_applicant:
            already_applied = (
                Application.query.filter_by(
                    job_id=job.id, applicant_id=g.user.id
                ).first()
                is not None
            )
        return render_template(
            "job_detail.html", job=job, already_applied=already_applied
        )

    # --- Post a job (employers) --------------------------------------------
    @app.route("/jobs/new", methods=["GET", "POST"])
    @role_required("employer")
    def new_job():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            location = request.form.get("location", "").strip()
            description = request.form.get("description", "").strip()
            if not title:
                flash("Title is required.", "error")
                return render_template("job_form.html", form=request.form)
            job = Job(
                employer_id=g.user.id,
                title=title,
                location=location,
                description=description,
            )
            db.session.add(job)
            db.session.commit()
            flash("Job posted.", "success")
            return redirect(url_for("job_applications", job_id=job.id))
        return render_template("job_form.html", form={})

    # --- Review applications for one job (employer, own jobs only) ----------
    @app.route("/jobs/<int:job_id>/applications")
    @role_required("employer")
    def job_applications(job_id):
        job = db.get_or_404(Job, job_id)
        if job.employer_id != g.user.id:
            abort(403)
        applications = (
            Application.query.filter_by(job_id=job.id)
            .order_by(Application.created_at.desc())
            .all()
        )
        return render_template(
            "job_applications.html", job=job, applications=applications
        )

    # --- Apply to a job (applicants) ---------------------------------------
    @app.route("/jobs/<int:job_id>/apply", methods=["GET", "POST"])
    @role_required("applicant")
    def apply(job_id):
        job = db.get_or_404(Job, job_id)
        existing = Application.query.filter_by(
            job_id=job.id, applicant_id=g.user.id
        ).first()
        if existing:
            flash("You have already applied to this job.", "error")
            return redirect(url_for("job_detail", job_id=job.id))

        if request.method == "POST":
            cover_letter = request.form.get("cover_letter", "").strip()
            file = request.files.get("resume")

            if file is None or file.filename == "":
                flash("A resume file is required.", "error")
                return render_template("apply.html", job=job, form=request.form)
            if not allowed_file(file.filename):
                flash(
                    "Unsupported file type. Allowed: "
                    + ", ".join(sorted(ALLOWED_EXTENSIONS)),
                    "error",
                )
                return render_template("apply.html", job=job, form=request.form)

            original_name = secure_filename(file.filename) or "resume"
            ext = original_name.rsplit(".", 1)[1].lower()
            stored_name = f"{uuid.uuid4().hex}.{ext}"
            file.save(os.path.join(app.config["UPLOAD_DIR"], stored_name))

            application = Application(
                job_id=job.id,
                applicant_id=g.user.id,
                cover_letter=cover_letter,
                resume_filename=stored_name,
                resume_original_name=original_name,
            )
            db.session.add(application)
            db.session.commit()
            flash("Application submitted.", "success")
            return redirect(url_for("dashboard"))

        return render_template("apply.html", job=job, form={})

    # --- Download/serve a resume (authorized parties only) ------------------
    @app.route("/applications/<int:application_id>/resume")
    @login_required
    def download_resume(application_id):
        application = db.get_or_404(Application, application_id)
        # Authorized: the applicant who submitted it, OR the employer who
        # owns the job it was submitted to. Nobody else.
        is_owner_applicant = application.applicant_id == g.user.id
        is_owning_employer = (
            g.user.is_employer and application.job.employer_id == g.user.id
        )
        if not (is_owner_applicant or is_owning_employer):
            abort(403)

        return send_from_directory(
            app.config["UPLOAD_DIR"],
            application.resume_filename,
            as_attachment=True,
            download_name=application.resume_original_name,
        )

    # --- Error handlers -----------------------------------------------------
    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You don't have access to that."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("error.html", code=413,
                               message="That file is too large (max 5 MB)."), 413


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5070, debug=True)
