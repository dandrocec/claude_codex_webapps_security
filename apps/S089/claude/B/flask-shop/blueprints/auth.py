"""Registration, login and logout."""
import sqlite3

from flask import (
    Blueprint, render_template, redirect, url_for, flash, request,
)
from flask_login import login_user, logout_user, login_required, current_user

from forms import RegisterForm, LoginForm
from models import create_user, get_user_by_email

bp = Blueprint("auth", __name__)


@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))
    form = RegisterForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        try:
            create_user(email, form.password.data)
        except sqlite3.IntegrityError:
            # Generic message: do not reveal whether an email is registered.
            flash("Could not create account with those details.", "error")
            return render_template("register.html", form=form), 400
        flash("Account created. Please log in.", "success")
        return redirect(url_for("auth.login"))
    return render_template("register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))
    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        user = get_user_by_email(email)
        # Constant-ish message regardless of which check fails.
        if user is None or not user.check_password(form.password.data):
            flash("Invalid email or password.", "error")
            return render_template("login.html", form=form), 401
        login_user(user)
        flash("Logged in successfully.", "success")
        return redirect(url_for("main.index"))
    return render_template("login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("Logged out.", "success")
    return redirect(url_for("main.index"))
