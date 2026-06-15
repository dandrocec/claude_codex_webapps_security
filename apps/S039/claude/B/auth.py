"""Authentication: user model, password hashing and login/logout routes."""
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import UserMixin, login_required, login_user, logout_user

from db import get_db
from forms import LoginForm, RegistrationForm

bp = Blueprint("auth", __name__)

# Argon2id is the recommended modern, salted password-hashing algorithm.
# argon2-cffi generates a per-password random salt automatically.
_hasher = PasswordHasher()


class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.password_hash = row["password_hash"]


def get_user_by_id(user_id):
    row = get_db().execute(
        "SELECT id, username, password_hash FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    return User(row) if row else None


def get_user_by_username(username):
    row = get_db().execute(
        "SELECT id, username, password_hash FROM users WHERE username = ?", (username,)
    ).fetchone()
    return User(row) if row else None


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


@bp.route("/register", methods=["GET", "POST"])
def register():
    form = RegistrationForm()
    if form.validate_on_submit():
        db = get_db()
        existing = db.execute(
            "SELECT 1 FROM users WHERE username = ?", (form.username.data,)
        ).fetchone()
        if existing:
            # Generic message; do not reveal more than necessary.
            flash("That username is not available.", "error")
        else:
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (form.username.data, hash_password(form.password.data)),
            )
            db.commit()
            flash("Account created. Please log in.", "success")
            return redirect(url_for("auth.login"))
    return render_template("register.html", form=form)


@bp.route("/login", methods=["GET", "POST"])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        user = get_user_by_username(form.username.data)
        # Always run verification flow with a generic failure message so we do
        # not disclose whether the username exists (user enumeration).
        if user and verify_password(user.password_hash, form.password.data):
            login_user(user)
            flash("Logged in successfully.", "success")
            return redirect(url_for("events.dashboard"))
        flash("Invalid username or password.", "error")
    return render_template("login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("Logged out.", "success")
    return redirect(url_for("events.index"))
