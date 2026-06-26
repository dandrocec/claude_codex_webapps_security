from functools import wraps
import os
import sqlite3

from flask import (
    Flask,
    abort,
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
DATABASE = os.path.join(BASE_DIR, "membership.sqlite3")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-membership-secret")


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


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return query_one("SELECT * FROM users WHERE id = ?", (user_id,))


@app.before_request
def load_current_user():
    g.user = current_user()


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            tier TEXT NOT NULL CHECK (tier IN ('free', 'premium')),
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.commit()

    seeds = [
        ("Admin User", "admin@example.com", "admin123", "premium", 1),
        ("Premium Member", "premium@example.com", "premium123", "premium", 0),
        ("Free Member", "free@example.com", "free123", "free", 0),
    ]
    for name, email, password, tier, is_admin in seeds:
        existing = query_one("SELECT id FROM users WHERE email = ?", (email,))
        if existing is None:
            db.execute(
                """
                INSERT INTO users (name, email, password_hash, tier, is_admin)
                VALUES (?, ?, ?, ?, ?)
                """,
                (name, email, generate_password_hash(password), tier, is_admin),
            )
    db.commit()


@app.before_request
def ensure_database():
    init_db()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to continue.", "warning")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped_view


def premium_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please sign in to view premium content.", "warning")
            return redirect(url_for("login", next=request.path))
        if g.user["tier"] != "premium" and not g.user["is_admin"]:
            flash("Premium membership is required for that page.", "danger")
            return redirect(url_for("upgrade"))
        return view(*args, **kwargs)

    return wrapped_view


def admin_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please sign in as an admin.", "warning")
            return redirect(url_for("login", next=request.path))
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)

    return wrapped_view


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/register", methods=("GET", "POST"))
def register():
    if g.user:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not name or not email or not password:
            flash("Name, email, and password are required.", "danger")
            return render_template("register.html")

        try:
            get_db().execute(
                """
                INSERT INTO users (name, email, password_hash, tier, is_admin)
                VALUES (?, ?, ?, 'free', 0)
                """,
                (name, email, generate_password_hash(password)),
            )
            get_db().commit()
        except sqlite3.IntegrityError:
            flash("An account with that email already exists.", "danger")
            return render_template("register.html")

        flash("Account created. Sign in to continue.", "success")
        return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if g.user:
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        user = query_one("SELECT * FROM users WHERE email = ?", (email,))

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid email or password.", "danger")
            return render_template("login.html")

        session.clear()
        session["user_id"] = user["id"]
        flash("Signed in successfully.", "success")
        return redirect(request.args.get("next") or url_for("dashboard"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Signed out.", "info")
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html")


@app.route("/premium")
@premium_required
def premium():
    return render_template("premium.html")


@app.route("/upgrade")
@login_required
def upgrade():
    return render_template("upgrade.html")


@app.route("/admin/users", methods=("GET", "POST"))
@admin_required
def admin_users():
    db = get_db()

    if request.method == "POST":
        user_id = request.form.get("user_id", type=int)
        tier = request.form.get("tier")

        if tier not in {"free", "premium"}:
            flash("Invalid tier selected.", "danger")
        elif user_id == g.user["id"] and tier != "premium":
            flash("Admin accounts must remain premium.", "danger")
        else:
            db.execute("UPDATE users SET tier = ? WHERE id = ?", (tier, user_id))
            db.commit()
            flash("User tier updated.", "success")

        return redirect(url_for("admin_users"))

    users = db.execute(
        "SELECT id, name, email, tier, is_admin, created_at FROM users ORDER BY created_at DESC, id DESC"
    ).fetchall()
    return render_template("admin_users.html", users=users)


@app.errorhandler(403)
def forbidden(error):
    return render_template("403.html"), 403


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5072, debug=True)
