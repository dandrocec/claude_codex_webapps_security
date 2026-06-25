import os
import re
import sqlite3
from datetime import date, datetime
from functools import wraps
from hmac import compare_digest
from secrets import token_urlsafe

import bcrypt
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


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_URL", os.path.join(BASE_DIR, "events.sqlite3"))
TITLE_RE = re.compile(r"^[\w\s.,:;!?'\-()&/]{3,120}$", re.ASCII)
LOCATION_RE = re.compile(r"^[\w\s.,:;#'\-()&/]{2,160}$", re.ASCII)
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required.")

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=parse_bool(os.environ.get("SESSION_COOKIE_SECURE"), True),
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=64 * 1024,
    )

    register_hooks(app)
    register_routes(app)
    register_errors(app)
    return app


def parse_bool(value, default):
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash BLOB NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            event_date TEXT NOT NULL,
            location TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_events_date ON events(event_date);
        CREATE INDEX IF NOT EXISTS idx_events_owner ON events(user_id);
        """
    )
    db.commit()


def register_hooks(app):
    @app.before_request
    def load_user():
        init_db()
        g.user = None
        user_id = session.get("user_id")
        if user_id:
            g.user = query_one("SELECT id, username FROM users WHERE id = ?", (user_id,))

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self'; object-src 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()


def register_routes(app):
    @app.route("/")
    def index():
        today = date.today().isoformat()
        events = query_all(
            """
            SELECT e.id, e.title, e.event_date, e.location, e.description, u.username
            FROM events e
            JOIN users u ON u.id = e.user_id
            WHERE e.event_date >= ?
            ORDER BY e.event_date ASC, e.title ASC
            """,
            (today,),
        )
        return render_template("index.html", events=events)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            validate_csrf()
            username = clean_text(request.form.get("username", ""), 40)
            password = request.form.get("password", "")

            if not USERNAME_RE.fullmatch(username):
                flash("Use 3-40 letters, numbers, dots, dashes, or underscores for username.", "error")
                return render_template("register.html"), 400
            if len(password) < 12 or len(password) > 128:
                flash("Password must be 12-128 characters.", "error")
                return render_template("register.html"), 400

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, password_hash),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
                return render_template("register.html"), 409

            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            validate_csrf()
            username = clean_text(request.form.get("username", ""), 40)
            password = request.form.get("password", "")
            user = query_one("SELECT id, username, password_hash FROM users WHERE username = ?", (username,))

            valid = bool(
                user
                and bcrypt.checkpw(password.encode("utf-8"), bytes(user["password_hash"]))
            )
            if not valid:
                flash("Invalid username or password.", "error")
                return render_template("login.html"), 401

            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = token_urlsafe(32)
            flash("Logged in.", "success")
            return redirect(url_for("dashboard"))
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        validate_csrf()
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        events = query_all(
            """
            SELECT id, title, event_date, location, description
            FROM events
            WHERE user_id = ?
            ORDER BY event_date ASC, title ASC
            """,
            (g.user["id"],),
        )
        return render_template("dashboard.html", events=events)

    @app.route("/events/new", methods=["GET", "POST"])
    @login_required
    def new_event():
        if request.method == "POST":
            validate_csrf()
            form, errors = validate_event_form(request.form)
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("event_form.html", event=form, action="Create"), 400

            db = get_db()
            db.execute(
                """
                INSERT INTO events (user_id, title, event_date, location, description)
                VALUES (?, ?, ?, ?, ?)
                """,
                (g.user["id"], form["title"], form["event_date"], form["location"], form["description"]),
            )
            db.commit()
            flash("Event created.", "success")
            return redirect(url_for("dashboard"))
        return render_template("event_form.html", event={}, action="Create")

    @app.route("/events/<int:event_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_event(event_id):
        event = owned_event_or_404(event_id)
        if request.method == "POST":
            validate_csrf()
            form, errors = validate_event_form(request.form)
            if errors:
                for error in errors:
                    flash(error, "error")
                form["id"] = event_id
                return render_template("event_form.html", event=form, action="Update"), 400

            db = get_db()
            db.execute(
                """
                UPDATE events
                SET title = ?, event_date = ?, location = ?, description = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (
                    form["title"],
                    form["event_date"],
                    form["location"],
                    form["description"],
                    event_id,
                    g.user["id"],
                ),
            )
            db.commit()
            flash("Event updated.", "success")
            return redirect(url_for("dashboard"))
        return render_template("event_form.html", event=event, action="Update")

    @app.route("/events/<int:event_id>/delete", methods=["POST"])
    @login_required
    def delete_event(event_id):
        validate_csrf()
        owned_event_or_404(event_id)
        db = get_db()
        db.execute("DELETE FROM events WHERE id = ? AND user_id = ?", (event_id, g.user["id"]))
        db.commit()
        flash("Event deleted.", "success")
        return redirect(url_for("dashboard"))


def register_errors(app):
    @app.errorhandler(400)
    def bad_request(error):
        return render_template("error.html", message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(error):
        return render_template("error.html", message="You are not allowed to do that."), 403

    @app.errorhandler(404)
    def not_found(error):
        return render_template("error.html", message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(error):
        return render_template("error.html", message="Request is too large."), 413

    @app.errorhandler(500)
    def server_error(error):
        return render_template("error.html", message="Something went wrong."), 500


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in first.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf():
    sent = request.form.get("csrf_token", "")
    expected = session.get("csrf_token", "")
    if not sent or not expected or not compare_digest(sent, expected):
        abort(403)


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def clean_text(value, max_len):
    value = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "")
    return value.strip()[:max_len]


def validate_event_form(form):
    title = clean_text(form.get("title", ""), 120)
    event_date = clean_text(form.get("event_date", ""), 10)
    location = clean_text(form.get("location", ""), 160)
    description = clean_text(form.get("description", ""), 2000)
    errors = []

    if not TITLE_RE.fullmatch(title):
        errors.append("Title must be 3-120 characters and use standard punctuation.")
    try:
        parsed_date = datetime.strptime(event_date, "%Y-%m-%d").date()
        if parsed_date < date.today():
            errors.append("Event date must be today or later.")
    except ValueError:
        errors.append("Enter a valid event date.")
    if not LOCATION_RE.fullmatch(location):
        errors.append("Location must be 2-160 characters and use standard punctuation.")
    if len(description) < 10:
        errors.append("Description must be at least 10 characters.")

    return (
        {
            "title": title,
            "event_date": event_date,
            "location": location,
            "description": description,
        },
        errors,
    )


def owned_event_or_404(event_id):
    event = query_one(
        """
        SELECT id, title, event_date, location, description
        FROM events
        WHERE id = ? AND user_id = ?
        """,
        (event_id, g.user["id"]),
    )
    if event is None:
        abort(404)
    return event


app = create_app()
app.jinja_env.globals["csrf_token"] = csrf_token


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5039, debug=False)
