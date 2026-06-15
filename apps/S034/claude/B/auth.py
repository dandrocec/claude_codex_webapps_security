"""Authentication: registration, login, logout.

Passwords are hashed with Argon2id (argon2-cffi), a memory-hard, salted
algorithm. The salt is generated and stored inside the hash string by the
library, so no separate salt column is needed.
"""
import sqlite3

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from flask import (
    Blueprint,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    login_required,
    login_user,
    logout_user,
)

from db import get_db
from forms import LoginForm, RegisterForm

bp = Blueprint("auth", __name__)
login_manager = LoginManager()
login_manager.login_view = "auth.login"
login_manager.login_message_category = "error"

# Argon2id with library defaults (sensible memory/time cost for a web app).
ph = PasswordHasher()


class User(UserMixin):
    def __init__(self, row: sqlite3.Row):
        self.id = row["id"]
        self.username = row["username"]
        self.password_hash = row["password_hash"]


@login_manager.user_loader
def load_user(user_id: str):
    db = get_db()
    row = db.execute(
        "SELECT id, username, password_hash FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return User(row) if row else None


@bp.route("/register", methods=["GET", "POST"])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        username = form.username.data.strip()
        db = get_db()
        existing = db.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()
        if existing:
            flash("That username is already taken.", "error")
        else:
            password_hash = ph.hash(form.password.data)
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, password_hash),
            )
            db.commit()
            flash("Account created. Please log in.", "success")
            return redirect(url_for("auth.login"))
    return render_template("register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        username = form.username.data.strip()
        db = get_db()
        row = db.execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        # Always run a verification to keep timing roughly constant whether or
        # not the username exists, and use one generic error message so we
        # don't reveal which field was wrong.
        valid = False
        if row is not None:
            try:
                ph.verify(row["password_hash"], form.password.data)
                valid = True
            except (VerifyMismatchError, VerificationError):
                valid = False
        else:
            try:
                ph.verify(
                    "$argon2id$v=19$m=65536,t=3,p=4$"
                    "c29tZXNhbHRzb21lc2FsdA$"
                    "RdescudvJCsgt3ub+b+dWRWJTmaaJObG",
                    form.password.data,
                )
            except Exception:
                pass

        if valid:
            # Re-hash if parameters have changed since the hash was created.
            if ph.check_needs_rehash(row["password_hash"]):
                db.execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (ph.hash(form.password.data), row["id"]),
                )
                db.commit()
            login_user(User(row))
            next_url = request.args.get("next")
            # Only allow relative redirect targets to prevent open redirects.
            if next_url and (not next_url.startswith("/") or next_url.startswith("//")):
                next_url = None
            return redirect(next_url or url_for("books.index"))
        flash("Invalid username or password.", "error")
    return render_template("login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "success")
    return redirect(url_for("auth.login"))
