"""Authentication blueprint: register, login, logout."""
import sqlite3

from flask import (
    Blueprint,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from db import get_db
from forms import LoginForm, RegisterForm
from security import DUMMY_HASH, hash_password, needs_rehash, verify_password

bp = Blueprint("auth", __name__)


@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user is not None:
        return redirect(url_for("tickets.index"))

    form = RegisterForm()
    if form.validate_on_submit():
        db = get_db()
        # Normalise email; store lowercase to keep uniqueness consistent.
        email = form.email.data.strip().lower()
        try:
            db.execute(
                "INSERT INTO users (email, name, password_hash, role) "
                "VALUES (?, ?, ?, 'customer')",
                (email, form.name.data.strip(), hash_password(form.password.data)),
            )
            db.commit()
        except sqlite3.IntegrityError:
            # Generic message — do not confirm which emails are registered.
            flash("Could not create the account with those details.", "error")
        else:
            flash("Account created. Please sign in.", "success")
            return redirect(url_for("auth.login"))

    return render_template("auth/register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user is not None:
        return redirect(url_for("tickets.index"))

    form = LoginForm()
    if form.validate_on_submit():
        db = get_db()
        email = form.email.data.strip().lower()
        user = db.execute(
            "SELECT id, password_hash FROM users WHERE email = ?", (email,)
        ).fetchone()

        # Always run verification work to avoid user-enumeration via timing.
        stored = user["password_hash"] if user else DUMMY_HASH
        ok = verify_password(stored, form.password.data)

        if user and ok:
            if needs_rehash(stored):
                db.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (hash_password(form.password.data), user["id"]),
                )
                db.commit()
            # Prevent session fixation: new session on privilege change.
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            flash("Signed in.", "success")
            next_url = request.args.get("next")
            # Only allow local redirects (open-redirect protection).
            if next_url and next_url.startswith("/") and not next_url.startswith("//"):
                return redirect(next_url)
            return redirect(url_for("tickets.index"))

        flash("Invalid email or password.", "error")

    return render_template("auth/login.html", form=form)


@bp.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("Signed out.", "success")
    return redirect(url_for("auth.login"))
