import os
from functools import wraps

from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash


db = SQLAlchemy()

STATUSES = ("todo", "doing", "done")


class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    memberships = db.relationship("Membership", back_populates="user", cascade="all, delete-orphan")
    assigned_tasks = db.relationship("Task", back_populates="assignee", foreign_keys="Task.assignee_id")


class Project(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(140), nullable=False)
    description = db.Column(db.Text, nullable=False, default="")
    owner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    owner = db.relationship("User")
    memberships = db.relationship("Membership", back_populates="project", cascade="all, delete-orphan")
    tasks = db.relationship("Task", back_populates="project", cascade="all, delete-orphan", order_by="Task.id.desc()")


class Membership(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    project_id = db.Column(db.Integer, db.ForeignKey("project.id"), nullable=False)

    user = db.relationship("User", back_populates="memberships")
    project = db.relationship("Project", back_populates="memberships")

    __table_args__ = (db.UniqueConstraint("user_id", "project_id", name="uq_member_project"),)


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(180), nullable=False)
    details = db.Column(db.Text, nullable=False, default="")
    status = db.Column(db.String(20), nullable=False, default="todo")
    project_id = db.Column(db.Integer, db.ForeignKey("project.id"), nullable=False)
    assignee_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=True)
    creator_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    project = db.relationship("Project", back_populates="tasks")
    assignee = db.relationship("User", back_populates="assigned_tasks", foreign_keys=[assignee_id])
    creator = db.relationship("User", foreign_keys=[creator_id])


def create_app():
    app = Flask(__name__, instance_relative_config=True)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
        app.instance_path, "project_board.sqlite3"
    )
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    os.makedirs(app.instance_path, exist_ok=True)
    db.init_app(app)

    with app.app_context():
        db.create_all()

    register_routes(app)
    return app


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.session.get(User, user_id)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            flash("Please log in first.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def member_required(view):
    @wraps(view)
    def wrapped(project_id, *args, **kwargs):
        project = db.session.get(Project, project_id)
        if project is None:
            abort(404)
        membership = Membership.query.filter_by(
            project_id=project.id, user_id=session.get("user_id")
        ).first()
        if membership is None:
            abort(403)
        return view(project, *args, **kwargs)

    return login_required(wrapped)


def add_member(project, user):
    exists = Membership.query.filter_by(project_id=project.id, user_id=user.id).first()
    if exists is None:
        db.session.add(Membership(project=project, user=user))


def register_routes(app):
    @app.context_processor
    def inject_globals():
        return {"current_user": current_user(), "statuses": STATUSES}

    @app.route("/")
    def index():
        if current_user() is None:
            return render_template("landing.html")
        return redirect(url_for("projects"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            if len(username) < 3 or len(password) < 6:
                flash("Use a username with 3+ characters and a password with 6+ characters.", "danger")
                return render_template("register.html")
            if User.query.filter_by(username=username).first():
                flash("That username is already taken.", "danger")
                return render_template("register.html")
            user = User(username=username, password_hash=generate_password_hash(password))
            db.session.add(user)
            db.session.commit()
            session["user_id"] = user.id
            flash("Account created.", "success")
            return redirect(url_for("projects"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = User.query.filter_by(username=username).first()
            if user is None or not check_password_hash(user.password_hash, password):
                flash("Invalid username or password.", "danger")
                return render_template("login.html")
            session["user_id"] = user.id
            flash("Logged in.", "success")
            return redirect(request.args.get("next") or url_for("projects"))
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    @app.route("/projects")
    @login_required
    def projects():
        user = current_user()
        memberships = (
            Membership.query.filter_by(user_id=user.id)
            .join(Project)
            .order_by(Project.id.desc())
            .all()
        )
        return render_template("projects.html", memberships=memberships)

    @app.route("/projects/new", methods=["GET", "POST"])
    @login_required
    def new_project():
        if request.method == "POST":
            name = request.form.get("name", "").strip()
            description = request.form.get("description", "").strip()
            if not name:
                flash("Project name is required.", "danger")
                return render_template("project_form.html")
            project = Project(name=name, description=description, owner=current_user())
            db.session.add(project)
            db.session.flush()
            add_member(project, current_user())
            db.session.commit()
            flash("Project created.", "success")
            return redirect(url_for("project_detail", project_id=project.id))
        return render_template("project_form.html")

    @app.route("/projects/<int:project_id>")
    @member_required
    def project_detail(project):
        members = [membership.user for membership in project.memberships]
        columns = {status: [] for status in STATUSES}
        for task in project.tasks:
            columns[task.status].append(task)
        return render_template("project_detail.html", project=project, members=members, columns=columns)

    @app.route("/projects/<int:project_id>/invite", methods=["POST"])
    @member_required
    def invite_member(project):
        username = request.form.get("username", "").strip()
        user = User.query.filter_by(username=username).first()
        if user is None:
            flash("No user found with that username.", "danger")
        else:
            add_member(project, user)
            db.session.commit()
            flash(f"{user.username} can now access this project.", "success")
        return redirect(url_for("project_detail", project_id=project.id))

    @app.route("/projects/<int:project_id>/tasks", methods=["POST"])
    @member_required
    def create_task(project):
        title = request.form.get("title", "").strip()
        details = request.form.get("details", "").strip()
        assignee_id = request.form.get("assignee_id") or None
        if not title:
            flash("Task title is required.", "danger")
            return redirect(url_for("project_detail", project_id=project.id))
        if assignee_id and not Membership.query.filter_by(project_id=project.id, user_id=assignee_id).first():
            flash("Assignee must be a project member.", "danger")
            return redirect(url_for("project_detail", project_id=project.id))
        task = Task(
            title=title,
            details=details,
            status="todo",
            project=project,
            assignee_id=assignee_id,
            creator=current_user(),
        )
        db.session.add(task)
        db.session.commit()
        flash("Task added.", "success")
        return redirect(url_for("project_detail", project_id=project.id))

    @app.route("/projects/<int:project_id>/tasks/<int:task_id>", methods=["POST"])
    @member_required
    def update_task(project, task_id):
        task = db.session.get(Task, task_id)
        if task is None or task.project_id != project.id:
            abort(404)
        status = request.form.get("status")
        assignee_id = request.form.get("assignee_id") or None
        if status not in STATUSES:
            flash("Invalid task status.", "danger")
            return redirect(url_for("project_detail", project_id=project.id))
        if assignee_id and not Membership.query.filter_by(project_id=project.id, user_id=assignee_id).first():
            flash("Assignee must be a project member.", "danger")
            return redirect(url_for("project_detail", project_id=project.id))
        task.status = status
        task.assignee_id = assignee_id
        db.session.commit()
        flash("Task updated.", "success")
        return redirect(url_for("project_detail", project_id=project.id))

    @app.route("/projects/<int:project_id>/tasks/<int:task_id>/delete", methods=["POST"])
    @member_required
    def delete_task(project, task_id):
        task = db.session.get(Task, task_id)
        if task is None or task.project_id != project.id:
            abort(404)
        db.session.delete(task)
        db.session.commit()
        flash("Task deleted.", "success")
        return redirect(url_for("project_detail", project_id=project.id))


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5064, debug=True)
