"""Candidate profile management and resume upload/download."""

from __future__ import annotations

import os
import secrets

from flask import (
    Blueprint,
    abort,
    current_app,
    flash,
    redirect,
    render_template,
    send_from_directory,
    url_for,
)
from flask_login import current_user, login_required

from . import models, security
from .forms import ProfileForm, ResumeForm

bp = Blueprint("profiles", __name__)

# Content type -> extension used for the server-generated filename on disk.
_EXT_FOR_TYPE = {"pdf": ".pdf", "doc": ".doc", "docx": ".docx"}


def _normalise_skills(raw: str) -> str:
    """Lower-case, de-duplicate and join skills with ', '."""
    seen: list[str] = []
    for part in (raw or "").split(","):
        token = part.strip().lower()
        if token and token not in seen:
            seen.append(token)
    return ", ".join(seen)


def _candidate_only() -> None:
    if not current_user.is_candidate:
        abort(403)


@bp.route("/profile", methods=["GET", "POST"])
@login_required
def edit_profile():
    _candidate_only()
    profile = models.get_profile_by_user(current_user.id)
    if profile is None:
        abort(404)

    form = ProfileForm(data=dict(profile))
    if form.validate_on_submit():
        models.update_profile(
            user_id=current_user.id,  # access control: always the logged-in user
            full_name=form.full_name.data.strip(),
            headline=(form.headline.data or "").strip(),
            location=(form.location.data or "").strip(),
            bio=(form.bio.data or "").strip(),
            skills=_normalise_skills(form.skills.data or ""),
        )
        flash("Profile saved.", "success")
        return redirect(url_for("profiles.edit_profile"))

    resume_form = ResumeForm()
    return render_template(
        "profiles/edit.html", form=form, resume_form=resume_form, profile=profile
    )


@bp.route("/profile/resume", methods=["POST"])
@login_required
def upload_resume():
    _candidate_only()
    form = ResumeForm()
    if not form.validate_on_submit():
        for errors in form.errors.values():
            for error in errors:
                flash(error, "error")
        return redirect(url_for("profiles.edit_profile"))

    file = form.resume.data

    # Validate by inspecting real content, not the client-supplied name/type.
    detected = security.detect_filetype(file.stream)
    if detected is None or detected not in _EXT_FOR_TYPE:
        flash("That file is not a valid PDF or Word document.", "error")
        return redirect(url_for("profiles.edit_profile"))

    upload_dir = current_app.config["UPLOAD_DIR"]
    # Server-generated random basename; the user-supplied name is never used
    # in the path, eliminating path traversal and overwrite risks.
    stored_name = secrets.token_hex(16) + _EXT_FOR_TYPE[detected]
    dest = os.path.join(upload_dir, stored_name)
    file.stream.seek(0)
    file.save(dest)

    # Replace any previous resume on disk.
    profile = models.get_profile_by_user(current_user.id)
    if profile and profile["resume_filename"]:
        _safe_remove(upload_dir, profile["resume_filename"])

    original = os.path.basename(file.filename or "")[:255]
    models.set_resume(current_user.id, stored_name, original)
    flash("Resume uploaded.", "success")
    return redirect(url_for("profiles.edit_profile"))


@bp.route("/resume/<int:profile_id>")
@login_required
def download_resume(profile_id: int):
    profile = models.get_profile_by_id(profile_id)
    if profile is None or not profile["resume_filename"]:
        abort(404)

    # Access control: recruiters may view any resume; candidates only their own.
    if not (current_user.is_recruiter or profile["user_id"] == current_user.id):
        abort(403)

    upload_dir = current_app.config["UPLOAD_DIR"]
    stored = profile["resume_filename"]

    # Defence in depth: the stored name is server-generated, but we still refuse
    # anything that is not a plain basename so a request can never escape the
    # upload directory.
    if stored != os.path.basename(stored):
        abort(404)

    download_name = profile["resume_original"] or "resume"
    return send_from_directory(
        upload_dir,
        stored,
        as_attachment=True,
        download_name=download_name,
    )


def _safe_remove(upload_dir: str, stored_name: str) -> None:
    if stored_name != os.path.basename(stored_name):
        return
    path = os.path.join(upload_dir, stored_name)
    try:
        os.remove(path)
    except OSError:
        pass
