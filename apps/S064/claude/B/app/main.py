"""Top-level routes."""
from flask import Blueprint, redirect, url_for
from flask_login import current_user

bp = Blueprint("main", __name__)


@bp.route("/")
def index():
    if current_user.is_authenticated:
        return redirect(url_for("projects.list_projects"))
    return redirect(url_for("auth.login"))


@bp.route("/healthz")
def healthz():
    return {"status": "ok"}, 200
