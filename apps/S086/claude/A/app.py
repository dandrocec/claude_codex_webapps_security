"""Admin dashboard web application.

A small Flask app providing:
  * Admin login (session based)
  * Dashboard with site statistics and a user list
  * Create / edit / deactivate (and reactivate) user accounts

Data is stored in a local SQLite database (admin_dashboard.db).
Run with:  python app.py   ->   http://127.0.0.1:5086
"""

import os
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
    BASE_DIR, "admin_dashboard.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(255), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    is_admin = db.Column(db.Boolean, default=False, nullable=False)
    is_active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(
        db.DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


@app.context_processor
def inject_current_user():
    user = None
    if "user_id" in session:
        user = db.session.get(User, session["user_id"])
    return {"current_user": user}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()
        if user and user.is_admin and user.is_active and user.check_password(password):
            session.clear()
            session["user_id"] = user.id
            flash("Welcome back, %s!" % user.username, "success")
            return redirect(url_for("dashboard"))
        flash("Invalid credentials or insufficient privileges.", "error")
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("login"))


@app.route("/")
@login_required
def dashboard():
    users = User.query.order_by(User.created_at.desc()).all()
    stats = {
        "total_users": User.query.count(),
        "active_users": User.query.filter_by(is_active=True).count(),
        "inactive_users": User.query.filter_by(is_active=False).count(),
        "admins": User.query.filter_by(is_admin=True).count(),
    }
    return render_template("dashboard.html", users=users, stats=stats)


@app.route("/users/new", methods=["GET", "POST"])
@login_required
def create_user():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")
        is_admin = bool(request.form.get("is_admin"))

        error = _validate_user_fields(username, email, password)
        if not error and User.query.filter_by(username=username).first():
            error = "That username is already taken."
        if not error and User.query.filter_by(email=email).first():
            error = "That email is already registered."

        if error:
            flash(error, "error")
            return render_template(
                "user_form.html",
                mode="create",
                form={"username": username, "email": email, "is_admin": is_admin},
            )

        user = User(username=username, email=email, is_admin=is_admin)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        flash("User '%s' created." % username, "success")
        return redirect(url_for("dashboard"))

    return render_template("user_form.html", mode="create", form={})


@app.route("/users/<int:user_id>/edit", methods=["GET", "POST"])
@login_required
def edit_user(user_id):
    user = db.session.get(User, user_id)
    if user is None:
        flash("User not found.", "error")
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        email = request.form.get("email", "").strip()
        password = request.form.get("password", "")
        is_admin = bool(request.form.get("is_admin"))

        # Password is optional on edit; only validate it when supplied.
        error = _validate_user_fields(username, email, password, require_password=False)

        clash = User.query.filter(
            User.username == username, User.id != user.id
        ).first()
        if not error and clash:
            error = "That username is already taken."
        clash = User.query.filter(User.email == email, User.id != user.id).first()
        if not error and clash:
            error = "That email is already registered."

        if error:
            flash(error, "error")
            return render_template(
                "user_form.html",
                mode="edit",
                user=user,
                form={"username": username, "email": email, "is_admin": is_admin},
            )

        user.username = username
        user.email = email
        user.is_admin = is_admin
        if password:
            user.set_password(password)
        db.session.commit()
        flash("User '%s' updated." % username, "success")
        return redirect(url_for("dashboard"))

    return render_template("user_form.html", mode="edit", user=user, form={})


@app.route("/users/<int:user_id>/toggle", methods=["POST"])
@login_required
def toggle_active(user_id):
    user = db.session.get(User, user_id)
    if user is None:
        flash("User not found.", "error")
        return redirect(url_for("dashboard"))

    if user.id == session.get("user_id"):
        flash("You cannot deactivate your own account.", "error")
        return redirect(url_for("dashboard"))

    user.is_active = not user.is_active
    db.session.commit()
    state = "reactivated" if user.is_active else "deactivated"
    flash("User '%s' %s." % (user.username, state), "success")
    return redirect(url_for("dashboard"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _validate_user_fields(username, email, password, require_password=True):
    if not username:
        return "Username is required."
    if not email or "@" not in email:
        return "A valid email is required."
    if require_password and len(password) < 6:
        return "Password must be at least 6 characters."
    if password and len(password) < 6:
        return "Password must be at least 6 characters."
    return None


def init_db():
    """Create tables and seed a default admin + a few demo users."""
    with app.app_context():
        db.create_all()
        if User.query.filter_by(username="admin").first() is None:
            admin = User(
                username="admin",
                email="admin@example.com",
                is_admin=True,
                is_active=True,
            )
            admin.set_password("admin123")
            db.session.add(admin)

            demo = [
                ("alice", "alice@example.com", True),
                ("bob", "bob@example.com", True),
                ("carol", "carol@example.com", False),
            ]
            for uname, mail, active in demo:
                u = User(username=uname, email=mail, is_admin=False, is_active=active)
                u.set_password("password123")
                db.session.add(u)

            db.session.commit()


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5086, debug=True)
