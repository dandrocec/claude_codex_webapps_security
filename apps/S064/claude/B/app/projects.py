"""Projects, members and tasks blueprint.

Access control is enforced centrally: every route that touches a project first
loads it through ``_get_member_project`` / ``_get_owned_project``, which abort
with 404/403 if the current user is not authorised. This prevents IDOR — a user
cannot read or mutate a project (or its tasks) by guessing IDs.
"""
from functools import wraps

from flask import (
    Blueprint,
    render_template,
    redirect,
    url_for,
    flash,
    abort,
    request,
)
from flask_login import login_required, current_user

from app import db
from app.models import User, Project, Membership, Task, TASK_STATUSES
from app.forms import ProjectForm, InviteForm, TaskForm, StatusForm, DeleteForm

bp = Blueprint("projects", __name__, url_prefix="/projects")


# --------------------------------------------------------------------------- #
# Authorisation helpers
# --------------------------------------------------------------------------- #
def _get_member_project(project_id: int) -> Project:
    """Return the project if the current user is a member, else abort.

    Returns 404 (not 403) for non-member access so we don't reveal whether a
    given project id exists.
    """
    project = db.session.get(Project, project_id)
    if project is None or not project.is_member(current_user.id):
        abort(404)
    return project


def _get_owned_project(project_id: int) -> Project:
    project = db.session.get(Project, project_id)
    if project is None or not project.is_member(current_user.id):
        abort(404)
    if not project.is_owner(current_user.id):
        abort(403)
    return project


def _get_project_task(project: Project, task_id: int) -> Task:
    task = db.session.get(Task, task_id)
    # The task must exist AND belong to this project (prevents cross-project
    # IDOR via mismatched ids).
    if task is None or task.project_id != project.id:
        abort(404)
    return task


def _assignee_choices(project: Project):
    members = (
        User.query.join(Membership, Membership.user_id == User.id)
        .filter(Membership.project_id == project.id)
        .order_by(User.username)
        .all()
    )
    choices = [("", "— Unassigned —")]
    choices += [(str(u.id), f"{u.username} ({u.email})") for u in members]
    return choices, {u.id for u in members}


# --------------------------------------------------------------------------- #
# Projects
# --------------------------------------------------------------------------- #
@bp.route("/")
@login_required
def list_projects():
    projects = (
        Project.query.join(Membership, Membership.project_id == Project.id)
        .filter(Membership.user_id == current_user.id)
        .order_by(Project.created_at.desc())
        .all()
    )
    return render_template("projects/list.html", projects=projects)


@bp.route("/new", methods=["GET", "POST"])
@login_required
def create_project():
    form = ProjectForm()
    if form.validate_on_submit():
        project = Project(
            name=form.name.data.strip(),
            description=(form.description.data or "").strip(),
            owner_id=current_user.id,
        )
        db.session.add(project)
        db.session.flush()  # assign project.id
        db.session.add(
            Membership(project_id=project.id, user_id=current_user.id, role="owner")
        )
        db.session.commit()
        flash("Project created.", "success")
        return redirect(url_for("projects.view_project", project_id=project.id))
    return render_template("projects/form.html", form=form, mode="create")


@bp.route("/<int:project_id>")
@login_required
def view_project(project_id: int):
    project = _get_member_project(project_id)
    columns = {status: [] for status in TASK_STATUSES}
    for task in sorted(project.tasks, key=lambda t: t.created_at):
        columns.setdefault(task.status, []).append(task)
    return render_template(
        "projects/board.html",
        project=project,
        columns=columns,
        statuses=TASK_STATUSES,
        is_owner=project.is_owner(current_user.id),
        status_form=StatusForm(),
        delete_form=DeleteForm(),
    )


@bp.route("/<int:project_id>/edit", methods=["GET", "POST"])
@login_required
def edit_project(project_id: int):
    project = _get_owned_project(project_id)
    form = ProjectForm(obj=project)
    if form.validate_on_submit():
        project.name = form.name.data.strip()
        project.description = (form.description.data or "").strip()
        db.session.commit()
        flash("Project updated.", "success")
        return redirect(url_for("projects.view_project", project_id=project.id))
    return render_template("projects/form.html", form=form, mode="edit", project=project)


@bp.route("/<int:project_id>/delete", methods=["POST"])
@login_required
def delete_project(project_id: int):
    project = _get_owned_project(project_id)
    form = DeleteForm()
    if form.validate_on_submit():
        db.session.delete(project)
        db.session.commit()
        flash("Project deleted.", "success")
    return redirect(url_for("projects.list_projects"))


# --------------------------------------------------------------------------- #
# Members
# --------------------------------------------------------------------------- #
@bp.route("/<int:project_id>/members", methods=["GET", "POST"])
@login_required
def members(project_id: int):
    # Any member can view the member list; only the owner can invite/remove.
    project = _get_member_project(project_id)
    is_owner = project.is_owner(current_user.id)
    form = InviteForm()
    if form.validate_on_submit():
        if not is_owner:
            abort(403)
        email = form.email.data.strip().lower()
        user = User.query.filter_by(email=email).first()
        if user is None:
            flash("No registered user with that email.", "danger")
        elif project.is_member(user.id):
            flash("That user is already a member.", "warning")
        else:
            db.session.add(
                Membership(project_id=project.id, user_id=user.id, role="member")
            )
            db.session.commit()
            flash(f"{user.username} added to the project.", "success")
        return redirect(url_for("projects.members", project_id=project.id))

    memberships = (
        Membership.query.filter_by(project_id=project.id)
        .order_by(Membership.created_at)
        .all()
    )
    return render_template(
        "projects/members.html",
        project=project,
        memberships=memberships,
        form=form,
        is_owner=is_owner,
        delete_form=DeleteForm(),
    )


@bp.route("/<int:project_id>/members/<int:user_id>/remove", methods=["POST"])
@login_required
def remove_member(project_id: int, user_id: int):
    project = _get_owned_project(project_id)
    form = DeleteForm()
    if not form.validate_on_submit():
        abort(400)
    if user_id == project.owner_id:
        flash("The owner cannot be removed.", "warning")
        return redirect(url_for("projects.members", project_id=project.id))
    membership = Membership.query.filter_by(
        project_id=project.id, user_id=user_id
    ).first()
    if membership:
        # Unassign that user from any tasks they held in this project.
        Task.query.filter_by(project_id=project.id, assignee_id=user_id).update(
            {"assignee_id": None}
        )
        db.session.delete(membership)
        db.session.commit()
        flash("Member removed.", "success")
    return redirect(url_for("projects.members", project_id=project.id))


# --------------------------------------------------------------------------- #
# Tasks
# --------------------------------------------------------------------------- #
@bp.route("/<int:project_id>/tasks/new", methods=["GET", "POST"])
@login_required
def create_task(project_id: int):
    project = _get_member_project(project_id)
    form = TaskForm()
    form.assignee_id.choices, member_ids = _assignee_choices(project)

    if form.validate_on_submit():
        assignee_id = _validated_assignee(form.assignee_id.data, member_ids)
        task = Task(
            project_id=project.id,
            title=form.title.data.strip(),
            description=(form.description.data or "").strip(),
            status=form.status.data,
            assignee_id=assignee_id,
            created_by=current_user.id,
        )
        db.session.add(task)
        db.session.commit()
        flash("Task created.", "success")
        return redirect(url_for("projects.view_project", project_id=project.id))

    return render_template(
        "projects/task_form.html", form=form, project=project, mode="create"
    )


@bp.route("/<int:project_id>/tasks/<int:task_id>/edit", methods=["GET", "POST"])
@login_required
def edit_task(project_id: int, task_id: int):
    project = _get_member_project(project_id)
    task = _get_project_task(project, task_id)
    form = TaskForm(obj=task)
    form.assignee_id.choices, member_ids = _assignee_choices(project)
    if request.method == "GET":
        form.assignee_id.data = str(task.assignee_id) if task.assignee_id else ""

    if form.validate_on_submit():
        task.title = form.title.data.strip()
        task.description = (form.description.data or "").strip()
        task.status = form.status.data
        task.assignee_id = _validated_assignee(form.assignee_id.data, member_ids)
        db.session.commit()
        flash("Task updated.", "success")
        return redirect(url_for("projects.view_project", project_id=project.id))

    return render_template(
        "projects/task_form.html", form=form, project=project, mode="edit", task=task
    )


@bp.route("/<int:project_id>/tasks/<int:task_id>/status", methods=["POST"])
@login_required
def update_status(project_id: int, task_id: int):
    project = _get_member_project(project_id)
    task = _get_project_task(project, task_id)
    form = StatusForm()
    if form.validate_on_submit() and form.status.data in TASK_STATUSES:
        task.status = form.status.data
        db.session.commit()
    else:
        flash("Invalid status change.", "danger")
    return redirect(url_for("projects.view_project", project_id=project.id))


@bp.route("/<int:project_id>/tasks/<int:task_id>/delete", methods=["POST"])
@login_required
def delete_task(project_id: int, task_id: int):
    project = _get_member_project(project_id)
    task = _get_project_task(project, task_id)
    form = DeleteForm()
    if form.validate_on_submit():
        db.session.delete(task)
        db.session.commit()
        flash("Task deleted.", "success")
    return redirect(url_for("projects.view_project", project_id=project.id))


def _validated_assignee(raw_value: str, member_ids: set[int]):
    """Coerce and validate the submitted assignee id against project members."""
    if not raw_value:
        return None
    try:
        candidate = int(raw_value)
    except (TypeError, ValueError):
        return None
    # Reject anyone who is not a member of this project (IDOR / tampering).
    return candidate if candidate in member_ids else None
