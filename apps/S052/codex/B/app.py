import os
import re
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

import bleach
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
from flask_bcrypt import Bcrypt
from flask_wtf import CSRFProtect
from wtforms import Form, PasswordField, SelectField, StringField, TextAreaField
from wtforms.validators import EqualTo, InputRequired, Length, Regexp


BASE_DIR = Path(__file__).resolve().parent
PRIORITIES = ("Low", "Medium", "High", "Urgent")
USERNAME_RE = r"^[A-Za-z0-9_.-]{3,40}$"

bcrypt = Bcrypt()
csrf = CSRFProtect()


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get("DATABASE_PATH", str(BASE_DIR / "support_tickets.db")),
        WTF_CSRF_TIME_LIMIT=3600,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=1800,
        MAX_CONTENT_LENGTH=32 * 1024,
    )

    bcrypt.init_app(app)
    csrf.init_app(app)

    with app.app_context():
        init_db()

    register_hooks(app)
    register_routes(app)
    register_errors(app)
    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app_config("DATABASE"),
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            subject TEXT NOT NULL,
            description TEXT NOT NULL,
            priority TEXT NOT NULL CHECK(priority IN ('Low', 'Medium', 'High', 'Urgent')),
            status TEXT NOT NULL DEFAULT 'Open',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON tickets(user_id);
        """
    )
    db.commit()


def register_hooks(app):
    @app.before_request
    def load_current_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = get_db().execute(
                "SELECT id, username FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if g.user is None:
                session.clear()

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.teardown_appcontext
    def close_db(_error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()


def register_routes(app):
    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("tickets"))
        return redirect(url_for("login"))

    @app.route("/register", methods=("GET", "POST"))
    def register():
        form = RegisterForm(request.form)
        if request.method == "POST" and form.validate():
            username = clean_text(form.username.data, 40)
            password_hash = bcrypt.generate_password_hash(form.password.data).decode("utf-8")
            try:
                get_db().execute(
                    """
                    INSERT INTO users (username, password_hash, created_at)
                    VALUES (?, ?, ?)
                    """,
                    (username, password_hash, utc_now()),
                )
                get_db().commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
            else:
                flash("Account created. Sign in to continue.", "success")
                return redirect(url_for("login"))
        elif request.method == "POST":
            flash("Please correct the highlighted fields.", "error")
        return render_template("register.html", form=form)

    @app.route("/login", methods=("GET", "POST"))
    def login():
        form = LoginForm(request.form)
        if request.method == "POST" and form.validate():
            username = clean_text(form.username.data, 40)
            user = get_db().execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            if user and bcrypt.check_password_hash(user["password_hash"], form.password.data):
                session.clear()
                session.permanent = True
                session["user_id"] = user["id"]
                return redirect(url_for("tickets"))
            flash("Invalid username or password.", "error")
        elif request.method == "POST":
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.post("/logout")
    def logout():
        require_login()
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("login"))

    @app.route("/tickets")
    @login_required
    def tickets():
        rows = get_db().execute(
            """
            SELECT id, subject, priority, status, created_at, updated_at
            FROM tickets
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (g.user["id"],),
        ).fetchall()
        return render_template("tickets.html", tickets=rows)

    @app.route("/tickets/new", methods=("GET", "POST"))
    @login_required
    def new_ticket():
        form = TicketForm(request.form)
        if request.method == "POST" and form.validate():
            subject = clean_text(form.subject.data, 120)
            description = clean_text(form.description.data, 4000)
            priority = form.priority.data
            if priority not in PRIORITIES:
                abort(400)
            now = utc_now()
            get_db().execute(
                """
                INSERT INTO tickets
                    (user_id, subject, description, priority, status, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'Open', ?, ?)
                """,
                (g.user["id"], subject, description, priority, now, now),
            )
            get_db().commit()
            flash("Ticket submitted.", "success")
            return redirect(url_for("tickets"))
        elif request.method == "POST":
            flash("Please correct the highlighted fields.", "error")
        return render_template("new_ticket.html", form=form)

    @app.route("/tickets/<int:ticket_id>")
    @login_required
    def ticket_detail(ticket_id):
        ticket = get_db().execute(
            """
            SELECT id, subject, description, priority, status, created_at, updated_at
            FROM tickets
            WHERE id = ? AND user_id = ?
            """,
            (ticket_id, g.user["id"]),
        ).fetchone()
        if ticket is None:
            abort(404)
        return render_template("ticket_detail.html", ticket=ticket)


def register_errors(app):
    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", message="Access denied."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(_error):
        return render_template("error.html", message="Request too large."), 413

    @app.errorhandler(500)
    def server_error(_error):
        return render_template("error.html", message="Something went wrong."), 500


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        require_login()
        return view(*args, **kwargs)

    return wrapped


def require_login():
    if g.get("user") is None:
        abort(403)


def clean_text(value, max_length):
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "")
    value = bleach.clean(value.strip(), tags=[], attributes={}, strip=True)
    return value[:max_length]


def utc_now():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class RegisterForm(Form):
    username = StringField(
        "Username",
        validators=[
            InputRequired(),
            Length(min=3, max=40),
            Regexp(USERNAME_RE, message="Use letters, numbers, dots, hyphens, or underscores."),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[
            InputRequired(),
            Length(min=12, max=128),
        ],
    )
    confirm_password = PasswordField(
        "Confirm password",
        validators=[
            InputRequired(),
            EqualTo("password", message="Passwords must match."),
        ],
    )


class LoginForm(Form):
    username = StringField(
        "Username",
        validators=[InputRequired(), Length(min=3, max=40), Regexp(USERNAME_RE)],
    )
    password = PasswordField("Password", validators=[InputRequired(), Length(max=128)])


class TicketForm(Form):
    subject = StringField("Subject", validators=[InputRequired(), Length(min=3, max=120)])
    description = TextAreaField(
        "Description", validators=[InputRequired(), Length(min=10, max=4000)]
    )
    priority = SelectField(
        "Priority",
        choices=[(priority, priority) for priority in PRIORITIES],
        validators=[InputRequired()],
    )


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5052)
