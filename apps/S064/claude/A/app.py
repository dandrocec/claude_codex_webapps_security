"""A small Flask project-management app with projects, members, and a task board."""
from functools import wraps

from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    current_user,
    login_required,
    login_user,
    logout_user,
)

from models import Project, Task, User, db


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "dev-secret-change-me"
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///pm.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

    db.init_app(app)

    login_manager = LoginManager()
    login_manager.login_view = "login"
    login_manager.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    with app.app_context():
        db.create_all()

    register_routes(app)
    return app


def member_required(view):
    """Ensure current_user is a member of the project named in <project_id>."""

    @wraps(view)
    @login_required
    def wrapped(project_id, *args, **kwargs):
        project = db.get_or_404(Project, project_id)
        if not project.has_member(current_user):
            abort(403)
        return view(project, *args, **kwargs)

    return wrapped


def register_routes(app):
    # ----- Auth -----
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            email = request.form.get("email", "").strip()
            password = request.form.get("password", "")
            if not (username and email and password):
                flash("All fields are required.", "error")
            elif User.query.filter_by(username=username).first():
                flash("Username already taken.", "error")
            elif User.query.filter_by(email=email).first():
                flash("Email already registered.", "error")
            else:
                user = User(username=username, email=email)
                user.set_password(password)
                db.session.add(user)
                db.session.commit()
                login_user(user)
                return redirect(url_for("dashboard"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = User.query.filter_by(username=username).first()
            if user and user.check_password(password):
                login_user(user)
                return redirect(url_for("dashboard"))
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout")
    @login_required
    def logout():
        logout_user()
        return redirect(url_for("login"))

    # ----- Projects -----
    @app.route("/")
    @login_required
    def dashboard():
        return render_template("dashboard.html", projects=current_user.projects)

    @app.route("/projects/new", methods=["POST"])
    @login_required
    def create_project():
        name = request.form.get("name", "").strip()
        if not name:
            flash("Project name is required.", "error")
            return redirect(url_for("dashboard"))
        project = Project(
            name=name,
            description=request.form.get("description", "").strip(),
            owner=current_user,
        )
        project.members.append(current_user)
        db.session.add(project)
        db.session.commit()
        return redirect(url_for("project_board", project_id=project.id))

    @app.route("/projects/<int:project_id>")
    @member_required
    def project_board(project):
        columns = {
            status: [t for t in project.tasks if t.status == status]
            for status in Task.STATUSES
        }
        return render_template("project.html", project=project, columns=columns)

    @app.route("/projects/<int:project_id>/invite", methods=["POST"])
    @member_required
    def invite_member(project):
        identifier = request.form.get("identifier", "").strip()
        user = User.query.filter(
            (User.username == identifier) | (User.email == identifier)
        ).first()
        if not user:
            flash(f"No user found matching '{identifier}'.", "error")
        elif project.has_member(user):
            flash(f"{user.username} is already a member.", "error")
        else:
            project.members.append(user)
            db.session.commit()
            flash(f"Added {user.username} to the project.", "success")
        return redirect(url_for("project_board", project_id=project.id))

    # ----- Tasks -----
    @app.route("/projects/<int:project_id>/tasks", methods=["POST"])
    @member_required
    def create_task(project):
        title = request.form.get("title", "").strip()
        if not title:
            flash("Task title is required.", "error")
            return redirect(url_for("project_board", project_id=project.id))
        assignee_id = request.form.get("assignee_id") or None
        if assignee_id:
            assignee = db.session.get(User, int(assignee_id))
            if assignee is None or not project.has_member(assignee):
                assignee_id = None
        task = Task(
            title=title,
            description=request.form.get("description", "").strip(),
            status="todo",
            project=project,
            assignee_id=int(assignee_id) if assignee_id else None,
        )
        db.session.add(task)
        db.session.commit()
        return redirect(url_for("project_board", project_id=project.id))

    @app.route(
        "/projects/<int:project_id>/tasks/<int:task_id>/update", methods=["POST"]
    )
    @member_required
    def update_task(project, task_id):
        task = db.get_or_404(Task, task_id)
        if task.project_id != project.id:
            abort(404)
        status = request.form.get("status")
        if status in Task.STATUSES:
            task.status = status
        if "assignee_id" in request.form:
            assignee_id = request.form.get("assignee_id") or None
            if assignee_id:
                assignee = db.session.get(User, int(assignee_id))
                task.assignee_id = assignee.id if assignee and project.has_member(assignee) else None
            else:
                task.assignee_id = None
        db.session.commit()
        return redirect(url_for("project_board", project_id=project.id))

    @app.route(
        "/projects/<int:project_id>/tasks/<int:task_id>/delete", methods=["POST"]
    )
    @member_required
    def delete_task(project, task_id):
        task = db.get_or_404(Task, task_id)
        if task.project_id != project.id:
            abort(404)
        db.session.delete(task)
        db.session.commit()
        return redirect(url_for("project_board", project_id=project.id))


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5064, debug=True)
