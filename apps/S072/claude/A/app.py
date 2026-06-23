"""A Flask membership site with free and premium tiers.

Features:
  * User registration and login (passwords hashed with Werkzeug).
  * Two membership tiers: "free" and "premium".
  * Premium content is gated behind the premium tier.
  * Tier-aware navigation rendered per request.
  * An admin role that can change any user's tier.
  * SQLite for persistence (created automatically on first run).

Run with:  python app.py   (serves on http://127.0.0.1:5072)
"""

import os
import sqlite3
from functools import wraps

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
DATABASE = os.path.join(BASE_DIR, "membership.db")
PORT = 5072

app = Flask(__name__)
# In a real deployment, set SECRET_KEY via an environment variable.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = DATABASE


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(_exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables and seed a default admin if the DB is empty."""
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    UNIQUE NOT NULL,
            password_hash TEXT    NOT NULL,
            tier          TEXT    NOT NULL DEFAULT 'free'
                              CHECK (tier IN ('free', 'premium')),
            is_admin      INTEGER NOT NULL DEFAULT 0
        );
        """
    )
    db.commit()

    # Seed a default admin account on first run.
    existing_admin = db.execute(
        "SELECT 1 FROM users WHERE is_admin = 1 LIMIT 1"
    ).fetchone()
    if existing_admin is None:
        db.execute(
            "INSERT INTO users (username, password_hash, tier, is_admin) "
            "VALUES (?, ?, 'premium', 1)",
            ("admin", generate_password_hash("admin123")),
        )
        db.commit()


# --------------------------------------------------------------------------- #
# Authentication helpers
# --------------------------------------------------------------------------- #
@app.before_request
def load_logged_in_user():
    """Attach the current user (or None) to flask.g for every request."""
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = (
            get_db()
            .execute("SELECT * FROM users WHERE id = ?", (user_id,))
            .fetchone()
        )


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def premium_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        if g.user["tier"] != "premium" and not g.user["is_admin"]:
            flash("That content is for premium members only.", "warning")
            return redirect(url_for("upgrade"))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        if not g.user["is_admin"]:
            flash("Admin access required.", "danger")
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Public + member routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user is not None:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        error = None

        if not username:
            error = "Username is required."
        elif not password:
            error = "Password is required."

        if error is None:
            db = get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, tier) "
                    "VALUES (?, ?, 'free')",
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                error = f"Username '{username}' is already taken."
            else:
                flash("Account created. You can now log in.", "success")
                return redirect(url_for("login"))

        flash(error, "danger")

    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user is not None:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        user = db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user is None or not check_password_hash(
            user["password_hash"], password
        ):
            flash("Invalid username or password.", "danger")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash(f"Welcome back, {user['username']}!", "success")
            next_url = request.args.get("next")
            return redirect(next_url or url_for("dashboard"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


@app.route("/free")
@login_required
def free_content():
    return render_template("free.html")


@app.route("/premium")
@premium_required
def premium_content():
    return render_template("premium.html")


@app.route("/upgrade")
@login_required
def upgrade():
    """A friendly page nudging free users toward premium."""
    return render_template("upgrade.html")


# --------------------------------------------------------------------------- #
# Admin routes
# --------------------------------------------------------------------------- #
@app.route("/admin")
@admin_required
def admin():
    users = (
        get_db()
        .execute("SELECT * FROM users ORDER BY is_admin DESC, username")
        .fetchall()
    )
    return render_template("admin.html", users=users)


@app.route("/admin/users/<int:user_id>/tier", methods=["POST"])
@admin_required
def set_tier(user_id):
    new_tier = request.form.get("tier", "")
    if new_tier not in ("free", "premium"):
        flash("Invalid tier.", "danger")
        return redirect(url_for("admin"))

    db = get_db()
    target = db.execute(
        "SELECT * FROM users WHERE id = ?", (user_id,)
    ).fetchone()
    if target is None:
        flash("User not found.", "danger")
        return redirect(url_for("admin"))

    db.execute("UPDATE users SET tier = ? WHERE id = ?", (new_tier, user_id))
    db.commit()
    flash(
        f"Set {target['username']}'s tier to {new_tier}.", "success"
    )
    return redirect(url_for("admin"))


# --------------------------------------------------------------------------- #
# Entry point
# --------------------------------------------------------------------------- #
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=PORT, debug=True)
