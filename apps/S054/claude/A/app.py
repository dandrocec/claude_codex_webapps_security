"""A small Flask time-tracking application.

Users register / log in, record time entries (project, date, hours, note),
and view weekly totals. Each user only ever sees their own data.
"""

import os
from collections import defaultdict
from datetime import date, datetime, timedelta

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
    BASE_DIR, "timetracker.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

login_manager = LoginManager(app)
login_manager.login_view = "login"


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    entries = db.relationship(
        "Entry", backref="user", lazy=True, cascade="all, delete-orphan"
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Entry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey("user.id"), nullable=False, index=True
    )
    project = db.Column(db.String(120), nullable=False)
    entry_date = db.Column(db.Date, nullable=False)
    hours = db.Column(db.Float, nullable=False)
    note = db.Column(db.String(500), nullable=False, default="")


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def week_start(d):
    """Return the Monday of the week containing date `d`."""
    return d - timedelta(days=d.weekday())


# --------------------------------------------------------------------------- #
# Auth routes
# --------------------------------------------------------------------------- #
@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        if not username or not password:
            flash("Username and password are required.", "error")
        elif User.query.filter_by(username=username).first():
            flash("That username is already taken.", "error")
        else:
            user = User(username=username)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            login_user(user)
            flash("Welcome! Your account has been created.", "success")
            return redirect(url_for("index"))

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""
        user = User.query.filter_by(username=username).first()

        if user and user.check_password(password):
            login_user(user)
            next_url = request.args.get("next")
            return redirect(next_url or url_for("index"))
        flash("Invalid username or password.", "error")

    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "success")
    return redirect(url_for("login"))


# --------------------------------------------------------------------------- #
# Application routes
# --------------------------------------------------------------------------- #
@app.route("/")
@login_required
def index():
    """List the current user's entries, most recent first."""
    entries = (
        Entry.query.filter_by(user_id=current_user.id)
        .order_by(Entry.entry_date.desc(), Entry.id.desc())
        .all()
    )
    return render_template("index.html", entries=entries, today=date.today())


@app.route("/entries/add", methods=["POST"])
@login_required
def add_entry():
    project = (request.form.get("project") or "").strip()
    note = (request.form.get("note") or "").strip()
    raw_date = request.form.get("entry_date") or ""
    raw_hours = request.form.get("hours") or ""

    errors = []
    if not project:
        errors.append("Project is required.")

    try:
        entry_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
    except ValueError:
        entry_date = None
        errors.append("A valid date is required.")

    try:
        hours = float(raw_hours)
        if hours <= 0 or hours > 24:
            errors.append("Hours must be between 0 and 24.")
    except ValueError:
        hours = None
        errors.append("Hours must be a number.")

    if errors:
        for message in errors:
            flash(message, "error")
        return redirect(url_for("index"))

    entry = Entry(
        user_id=current_user.id,
        project=project,
        entry_date=entry_date,
        hours=hours,
        note=note,
    )
    db.session.add(entry)
    db.session.commit()
    flash("Time entry added.", "success")
    return redirect(url_for("index"))


@app.route("/entries/<int:entry_id>/delete", methods=["POST"])
@login_required
def delete_entry(entry_id):
    entry = db.session.get(Entry, entry_id)
    # Scope the lookup to the current user so nobody can touch others' data.
    if entry is None or entry.user_id != current_user.id:
        flash("Entry not found.", "error")
        return redirect(url_for("index"))

    db.session.delete(entry)
    db.session.commit()
    flash("Time entry deleted.", "success")
    return redirect(url_for("index"))


@app.route("/weekly")
@login_required
def weekly():
    """Show totals grouped by week, then by project within each week."""
    entries = Entry.query.filter_by(user_id=current_user.id).all()

    # week_start_date -> {"total": float, "projects": {project: hours}}
    weeks = defaultdict(lambda: {"total": 0.0, "projects": defaultdict(float)})
    for entry in entries:
        start = week_start(entry.entry_date)
        weeks[start]["total"] += entry.hours
        weeks[start]["projects"][entry.project] += entry.hours

    # Build a sorted, template-friendly structure (newest week first).
    weekly_data = []
    for start in sorted(weeks.keys(), reverse=True):
        bucket = weeks[start]
        weekly_data.append(
            {
                "start": start,
                "end": start + timedelta(days=6),
                "total": bucket["total"],
                "projects": sorted(bucket["projects"].items()),
            }
        )

    return render_template("weekly.html", weekly_data=weekly_data)


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(host="127.0.0.1", port=5054, debug=True)
