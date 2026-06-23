"""Landing page and recruiter search / profile viewing."""

from __future__ import annotations

from flask import Blueprint, abort, redirect, render_template, request, url_for
from flask_login import current_user, login_required

from . import models
from .forms import SearchForm

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    if not current_user.is_authenticated:
        return redirect(url_for("auth.login"))
    if current_user.is_recruiter:
        return redirect(url_for("main.search"))
    return redirect(url_for("profiles.edit_profile"))


@bp.route("/search")
@login_required
def search():
    if not current_user.is_recruiter:
        abort(403)

    form = SearchForm(request.args, meta={"csrf": False})
    results = []
    term = ""
    if form.skill.data and form.validate():
        term = form.skill.data.strip()
        results = models.search_candidates_by_skill(term)
    else:
        results = models.list_recent_candidates()

    return render_template("main/search.html", form=form, results=results, term=term)


@bp.route("/candidate/<int:profile_id>")
@login_required
def view_candidate(profile_id: int):
    if not current_user.is_recruiter:
        abort(403)
    profile = models.get_profile_by_id(profile_id)
    if profile is None:
        abort(404)
    skills = [s for s in (profile["skills"] or "").split(", ") if s]
    return render_template("main/candidate.html", profile=profile, skills=skills)
