"""Authentication: registration, login, logout."""

from __future__ import annotations

import sqlite3

from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import current_user, login_required, login_user, logout_user

from . import models, security
from .forms import LoginForm, RegisterForm

bp = Blueprint("auth", __name__)


@bp.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    form = RegisterForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        password_hash = security.hash_password(form.password.data)
        try:
            models.create_user(
                email=email,
                password_hash=password_hash,
                role=form.role.data,
                full_name=form.full_name.data.strip(),
            )
        except sqlite3.IntegrityError:
            # Unique-constraint violation. Generic message avoids confirming
            # which emails are registered.
            flash("Could not create the account with those details.", "error")
            return render_template("auth/register.html", form=form), 409

        flash("Account created. Please log in.", "success")
        return redirect(url_for("auth.login"))

    return render_template("auth/register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("main.index"))

    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        record = models.get_user_record_by_email(email)

        # Same generic error whether the email exists or the password is wrong.
        if record is None or not security.verify_password(
            record["password_hash"], form.password.data
        ):
            flash("Invalid email or password.", "error")
            return render_template("auth/login.html", form=form), 401

        # Transparently upgrade the stored hash if parameters have changed.
        if security.needs_rehash(record["password_hash"]):
            models.update_password_hash(
                record["id"], security.hash_password(form.password.data)
            )

        user = models.get_user_by_id(record["id"])
        login_user(user, remember=form.remember.data)
        flash("Logged in.", "success")
        return redirect(url_for("main.index"))

    return render_template("auth/login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("Logged out.", "success")
    return redirect(url_for("auth.login"))
