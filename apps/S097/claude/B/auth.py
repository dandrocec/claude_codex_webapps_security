"""Authentication: register, login, logout."""
import sqlite3
from functools import wraps

from flask import (
    Blueprint, render_template, redirect, url_for, flash, request, abort
)
from flask_login import login_user, logout_user, login_required, current_user

from forms import RegisterForm, LoginForm
from models import User

bp = Blueprint("auth", __name__)


def admin_required(view):
    """Restrict a view to admin users (proper access control)."""
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not current_user.is_admin:
            abort(403)
        return view(*args, **kwargs)
    return wrapped


@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("store.index"))

    form = RegisterForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        name = form.name.data.strip()
        try:
            user = User.create(email, name, form.password.data, is_admin=False)
        except sqlite3.IntegrityError:
            # Email already registered. Avoid confirming which part failed.
            flash("Could not create the account. Try a different email.", "error")
            return render_template("auth/register.html", form=form)

        login_user(user)
        flash("Welcome! Your account has been created.", "success")
        return redirect(url_for("store.index"))

    return render_template("auth/register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("store.index"))

    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        user = User.get_by_email(email)
        # Generic message + constant work regardless of which field is wrong,
        # to avoid user enumeration.
        if user is None or not user.check_password(form.password.data):
            flash("Invalid email or password.", "error")
            return render_template("auth/login.html", form=form)

        login_user(user)
        flash("Signed in successfully.", "success")
        return redirect(url_for("store.index"))

    return render_template("auth/login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("You have been signed out.", "success")
    return redirect(url_for("store.index"))
