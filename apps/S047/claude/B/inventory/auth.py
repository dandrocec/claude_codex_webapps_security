"""Authentication: registration, login, logout, session handling."""
from __future__ import annotations

import bcrypt
from flask import Blueprint, flash, redirect, render_template, request, url_for
from flask_login import LoginManager, UserMixin, login_required, login_user, logout_user

from .db import get_db
from .forms import LoginForm, RegisterForm

bp = Blueprint("auth", __name__, url_prefix="/auth")

login_manager = LoginManager()
login_manager.login_view = "auth.login"
login_manager.login_message = "Please log in to continue."
login_manager.session_protection = "strong"


class User(UserMixin):
    def __init__(self, row):
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


def _hash_password(password: str) -> str:
    # bcrypt: strong, salted, adaptive work factor. Salt is generated per-hash.
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# A pre-computed valid bcrypt hash used only to spend comparable CPU time when the
# username does not exist, mitigating timing-based username enumeration.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode("utf-8")


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except (ValueError, TypeError):
        return False


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
            # Generic message; avoid confirming which usernames exist beyond the unique check.
            flash("That username is not available.", "error")
        else:
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, _hash_password(form.password.data)),
            )
            db.commit()
            flash("Account created. Please log in.", "success")
            return redirect(url_for("auth.login"))
    return render_template("auth/register.html", form=form)


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
        # Verify even when the user is missing to reduce username enumeration via timing.
        if row and _verify_password(form.password.data, row["password_hash"]):
            login_user(User(row))
            next_url = request.args.get("next")
            # Only allow safe, same-site relative redirects (open-redirect guard).
            if next_url and next_url.startswith("/") and not next_url.startswith("//"):
                return redirect(next_url)
            return redirect(url_for("items.index"))
        else:
            # Spend comparable time when the user is missing to flatten timing signals.
            _verify_password(form.password.data, _DUMMY_HASH)
            flash("Invalid username or password.", "error")
    return render_template("auth/login.html", form=form)


@bp.route("/logout", methods=["POST"])
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "success")
    return redirect(url_for("auth.login"))
