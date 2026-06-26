from datetime import datetime, timezone
import os
import sqlite3

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "admin_dashboard.sqlite3")


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-this-secret")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS admins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL DEFAULT 'Member',
            status TEXT NOT NULL DEFAULT 'active',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        """
    )

    admin_exists = db.execute("SELECT id FROM admins WHERE username = ?", ("admin",)).fetchone()
    if admin_exists is None:
        db.execute(
            "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)",
            ("admin", generate_password_hash("admin123"), utc_now()),
        )

    user_count = db.execute("SELECT COUNT(*) AS total FROM users").fetchone()["total"]
    if user_count == 0:
        now = utc_now()
        sample_users = [
            ("Avery Johnson", "avery@example.com", "Manager", "active", now, now),
            ("Blake Chen", "blake@example.com", "Editor", "active", now, now),
            ("Casey Morgan", "casey@example.com", "Viewer", "inactive", now, now),
            ("Dana Rivera", "dana@example.com", "Support", "active", now, now),
        ]
        db.executemany(
            """
            INSERT INTO users (name, email, role, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            sample_users,
        )

    db.commit()


@app.before_request
def ensure_database():
    init_db()


def login_required(view_func):
    def wrapped_view(**kwargs):
        if "admin_id" not in session:
            return redirect(url_for("login"))
        return view_func(**kwargs)

    wrapped_view.__name__ = view_func.__name__
    return wrapped_view


@app.route("/", methods=["GET", "POST"])
def login():
    if "admin_id" in session:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        admin = get_db().execute(
            "SELECT * FROM admins WHERE username = ?", (username,)
        ).fetchone()

        if admin and check_password_hash(admin["password_hash"], password):
            session.clear()
            session["admin_id"] = admin["id"]
            session["admin_username"] = admin["username"]
            return redirect(url_for("dashboard"))

        flash("Invalid username or password.", "error")

    return render_template("login.html")


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    db = get_db()
    users = db.execute("SELECT * FROM users ORDER BY created_at DESC, id DESC").fetchall()
    stats = {
        "total": db.execute("SELECT COUNT(*) AS value FROM users").fetchone()["value"],
        "active": db.execute(
            "SELECT COUNT(*) AS value FROM users WHERE status = 'active'"
        ).fetchone()["value"],
        "inactive": db.execute(
            "SELECT COUNT(*) AS value FROM users WHERE status = 'inactive'"
        ).fetchone()["value"],
        "admins": db.execute("SELECT COUNT(*) AS value FROM admins").fetchone()["value"],
    }
    return render_template("dashboard.html", users=users, stats=stats)


def validate_user_form(name, email, role):
    errors = []
    if not name:
        errors.append("Name is required.")
    if not email or "@" not in email:
        errors.append("A valid email address is required.")
    if not role:
        errors.append("Role is required.")
    return errors


@app.route("/users/new", methods=["GET", "POST"])
@login_required
def create_user():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        role = request.form.get("role", "").strip()
        errors = validate_user_form(name, email, role)

        if errors:
            for error in errors:
                flash(error, "error")
        else:
            try:
                now = utc_now()
                get_db().execute(
                    """
                    INSERT INTO users (name, email, role, status, created_at, updated_at)
                    VALUES (?, ?, ?, 'active', ?, ?)
                    """,
                    (name, email, role, now, now),
                )
                get_db().commit()
                flash("User account created.", "success")
                return redirect(url_for("dashboard"))
            except sqlite3.IntegrityError:
                flash("A user with that email already exists.", "error")

    return render_template("user_form.html", user=None, action="Create")


@app.route("/users/<int:user_id>/edit", methods=["GET", "POST"])
@login_required
def edit_user(user_id):
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    if user is None:
        flash("User not found.", "error")
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        role = request.form.get("role", "").strip()
        status = request.form.get("status", "active")
        errors = validate_user_form(name, email, role)
        if status not in {"active", "inactive"}:
            errors.append("Status must be active or inactive.")

        if errors:
            for error in errors:
                flash(error, "error")
        else:
            try:
                db.execute(
                    """
                    UPDATE users
                    SET name = ?, email = ?, role = ?, status = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (name, email, role, status, utc_now(), user_id),
                )
                db.commit()
                flash("User account updated.", "success")
                return redirect(url_for("dashboard"))
            except sqlite3.IntegrityError:
                flash("A user with that email already exists.", "error")

    return render_template("user_form.html", user=user, action="Edit")


@app.route("/users/<int:user_id>/deactivate", methods=["POST"])
@login_required
def deactivate_user(user_id):
    db = get_db()
    db.execute(
        "UPDATE users SET status = 'inactive', updated_at = ? WHERE id = ?",
        (utc_now(), user_id),
    )
    db.commit()
    flash("User account deactivated.", "success")
    return redirect(url_for("dashboard"))


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5086, debug=True)
