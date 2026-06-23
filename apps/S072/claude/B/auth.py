"""Authentication routes: register, login, logout."""
from flask import (Blueprint, flash, g, redirect, render_template, request,
                   url_for)

import db
from forms import LoginForm, RegisterForm
from security import (hash_password, login_required, login_user, logout_user,
                      verify_password)

bp = Blueprint("auth", __name__)


def _safe_next(target: str | None) -> str:
    """Only allow same-site relative redirects (prevents open redirect)."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return url_for("main.index")


@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user is not None:
        return redirect(url_for("main.index"))

    form = RegisterForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        if db.get_user_by_email(email) is not None:
            # Generic message; do not reveal which emails are registered.
            flash("Could not create the account with those details.", "error")
        else:
            user_id = db.create_user(
                email=email,
                display_name=form.display_name.data.strip(),
                password_hash=hash_password(form.password.data),
            )
            login_user(user_id)
            flash("Welcome! Your free account is ready.", "success")
            return redirect(url_for("main.index"))
    return render_template("register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user is not None:
        return redirect(url_for("main.index"))

    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        user = db.get_user_by_email(email)
        # Always run a hash comparison to keep timing roughly constant and
        # return a single generic error (no user enumeration).
        if user is None or not verify_password(form.password.data, user["password_hash"]):
            flash("Invalid email or password.", "error")
        else:
            login_user(user["id"])
            flash("Signed in successfully.", "success")
            return redirect(_safe_next(request.args.get("next")))
    return render_template("login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("You have been signed out.", "success")
    return redirect(url_for("main.index"))
