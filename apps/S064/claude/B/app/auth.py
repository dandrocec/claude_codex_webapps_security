"""Authentication blueprint: registration, login, logout."""
from flask import Blueprint, render_template, redirect, url_for, flash, request
from flask_login import login_user, logout_user, login_required, current_user

from app import db
from app.models import User
from app.forms import RegistrationForm, LoginForm

bp = Blueprint("auth", __name__)


def _is_safe_next(target: str) -> bool:
    """Only permit relative redirects to avoid open-redirect attacks."""
    return bool(target) and target.startswith("/") and not target.startswith("//")


@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("projects.list_projects"))

    form = RegistrationForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        # Parameterised query via the ORM.
        existing = User.query.filter_by(email=email).first()
        if existing:
            # Avoid confirming which emails are registered beyond a generic msg.
            flash("Could not create the account with those details.", "danger")
            return render_template("auth/register.html", form=form)

        user = User(email=email, username=form.username.data.strip())
        user.set_password(form.password.data)
        db.session.add(user)
        db.session.commit()
        flash("Account created. Please log in.", "success")
        return redirect(url_for("auth.login"))

    return render_template("auth/register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("projects.list_projects"))

    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        user = User.query.filter_by(email=email).first()
        # Generic message regardless of whether the email or password failed,
        # to avoid user enumeration.
        if user is None or not user.check_password(form.password.data):
            flash("Invalid email or password.", "danger")
            return render_template("auth/login.html", form=form)

        login_user(user)
        next_page = request.args.get("next")
        if _is_safe_next(next_page):
            return redirect(next_page)
        return redirect(url_for("projects.list_projects"))

    return render_template("auth/login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "success")
    return redirect(url_for("auth.login"))
