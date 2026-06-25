import difflib
import os
import sqlite3
from functools import wraps
from html import escape

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
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
from flask_wtf import CSRFProtect
from markupsafe import Markup
from wtforms import PasswordField, StringField, SubmitField, TextAreaField
from wtforms.validators import DataRequired, Email, Length
from flask_wtf import FlaskForm


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "diff_app.sqlite3"))
MAX_TEXT_CHARS = 20000

csrf = CSRFProtect()
password_hasher = PasswordHasher()


class DiffForm(FlaskForm):
    left_text = TextAreaField("Original text", validators=[Length(max=MAX_TEXT_CHARS)])
    right_text = TextAreaField("Modified text", validators=[Length(max=MAX_TEXT_CHARS)])
    submit = SubmitField("Compare")


class RegisterForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=12, max=128)])
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Sign in")


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        WTF_CSRF_TIME_LIMIT=3600,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=64 * 1024,
    )
    csrf.init_app(app)

    @app.before_request
    def load_current_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            user = query_one("SELECT id, email FROM users WHERE id = ?", (user_id,))
            if user:
                g.user = user
            else:
                session.clear()

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(500)
    def handle_error(error):
        code = getattr(error, "code", 500)
        return render_template("error.html", code=code), code

    @app.route("/", methods=["GET", "POST"])
    def index():
        form = DiffForm()
        diff_rows = []
        if form.validate_on_submit():
            left_text = normalise_text(form.left_text.data)
            right_text = normalise_text(form.right_text.data)
            diff_rows = build_diff(left_text, right_text)
            if g.user:
                execute_query(
                    """
                    INSERT INTO comparisons (user_id, left_text, right_text)
                    VALUES (?, ?, ?)
                    """,
                    (g.user["id"], left_text, right_text),
                )
        elif request.method == "POST":
            flash("Please keep each text under 20,000 characters.", "error")

        recent = []
        if g.user:
            recent = query_all(
                """
                SELECT id, created_at
                FROM comparisons
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT 5
                """,
                (g.user["id"],),
            )
        return render_template("index.html", form=form, diff_rows=diff_rows, recent=recent)

    @app.route("/comparison/<int:comparison_id>")
    @login_required
    def comparison(comparison_id):
        comparison_row = query_one(
            """
            SELECT id, left_text, right_text, created_at
            FROM comparisons
            WHERE id = ? AND user_id = ?
            """,
            (comparison_id, g.user["id"]),
        )
        if comparison_row is None:
            abort(404)

        form = DiffForm(
            left_text=comparison_row["left_text"],
            right_text=comparison_row["right_text"],
        )
        diff_rows = build_diff(comparison_row["left_text"], comparison_row["right_text"])
        return render_template("index.html", form=form, diff_rows=diff_rows, recent=[])

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if g.user:
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            existing = query_one("SELECT id FROM users WHERE email = ?", (email,))
            if existing:
                flash("An account with that email already exists.", "error")
            else:
                password_hash = password_hasher.hash(form.password.data)
                execute_query(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, password_hash),
                )
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))
        return render_template("auth.html", form=form, title="Create account")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if g.user:
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            user = query_one("SELECT id, password_hash FROM users WHERE email = ?", (email,))
            if user and verify_password(user["password_hash"], form.password.data):
                session.clear()
                session["user_id"] = user["id"]
                return redirect(url_for("index"))
            flash("Invalid email or password.", "error")
        return render_template("auth.html", form=form, title="Sign in")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


def execute_query(sql, params=()):
    db = get_db()
    db.execute(sql, params)
    db.commit()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS comparisons (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            left_text TEXT NOT NULL,
            right_text TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )
    db.commit()


def normalise_text(value):
    if value is None:
        return ""
    return value.replace("\r\n", "\n").replace("\r", "\n")[:MAX_TEXT_CHARS]


def build_diff(left_text, right_text):
    left_lines = left_text.splitlines()
    right_lines = right_text.splitlines()
    rows = []
    for line in difflib.ndiff(left_lines, right_lines):
        marker = line[:2]
        text = Markup(escape(line[2:]))
        if marker == "- ":
            rows.append({"kind": "removed", "prefix": "-", "text": text})
        elif marker == "+ ":
            rows.append({"kind": "added", "prefix": "+", "text": text})
        elif marker == "  ":
            rows.append({"kind": "unchanged", "prefix": " ", "text": text})
    return rows


def verify_password(password_hash, password):
    try:
        return password_hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5019)
