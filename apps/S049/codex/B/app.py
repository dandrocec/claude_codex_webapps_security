import os
import re
import sqlite3
import secrets
from datetime import timedelta
from email.utils import parseaddr

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
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
from markupsafe import Markup, escape


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_URL", os.path.join(BASE_DIR, "newsletter.sqlite3"))
ph = PasswordHasher()


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
    )

    @app.before_request
    def load_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = query_one("SELECT id, email FROM users WHERE id = ?", (user_id,))

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", title="Bad request", message="The request could not be processed."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", title="Forbidden", message="You do not have access to that resource."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", title="Not found", message="The requested page was not found."), 404

    @app.errorhandler(500)
    def server_error(_error):
        return render_template("error.html", title="Server error", message="Something went wrong."), 500

    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("dashboard"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            validate_csrf()
            email = clean_email(request.form.get("email", ""))
            password = request.form.get("password", "")
            errors = validate_editor(email, password)
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("register.html"), 400

            try:
                execute(
                    "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                    (email, ph.hash(password)),
                )
            except sqlite3.IntegrityError:
                flash("An account with that email already exists.", "error")
                return render_template("register.html"), 400

            flash("Account created. Sign in to continue.", "success")
            return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            validate_csrf()
            email = clean_email(request.form.get("email", ""))
            password = request.form.get("password", "")
            user = query_one("SELECT id, email, password_hash FROM users WHERE email = ?", (email,))
            if not user or not verify_password(user["password_hash"], password):
                flash("Invalid email or password.", "error")
                return render_template("login.html"), 401

            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("dashboard"))
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        validate_csrf()
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("login"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        subscribers = query_all(
            "SELECT id, email, name, active, created_at FROM subscribers WHERE user_id = ? ORDER BY created_at DESC",
            (g.user["id"],),
        )
        drafts = query_all(
            "SELECT id, subject, updated_at FROM drafts WHERE user_id = ? ORDER BY updated_at DESC",
            (g.user["id"],),
        )
        return render_template("dashboard.html", subscribers=subscribers, drafts=drafts)

    @app.route("/subscribers", methods=["POST"])
    @login_required
    def create_subscriber():
        validate_csrf()
        email = clean_email(request.form.get("email", ""))
        name = clean_text(request.form.get("name", ""), 80)
        if not valid_email(email):
            flash("Enter a valid subscriber email address.", "error")
            return redirect(url_for("dashboard"))
        if len(name) > 80:
            flash("Subscriber name is too long.", "error")
            return redirect(url_for("dashboard"))
        try:
            execute(
                "INSERT INTO subscribers (user_id, email, name, active) VALUES (?, ?, ?, 1)",
                (g.user["id"], email, name),
            )
            flash("Subscriber added.", "success")
        except sqlite3.IntegrityError:
            flash("That subscriber already exists.", "error")
        return redirect(url_for("dashboard"))

    @app.route("/subscribers/<int:subscriber_id>/toggle", methods=["POST"])
    @login_required
    def toggle_subscriber(subscriber_id):
        validate_csrf()
        subscriber = owned_subscriber_or_404(subscriber_id)
        execute(
            "UPDATE subscribers SET active = CASE active WHEN 1 THEN 0 ELSE 1 END WHERE id = ? AND user_id = ?",
            (subscriber["id"], g.user["id"]),
        )
        flash("Subscriber status updated.", "success")
        return redirect(url_for("dashboard"))

    @app.route("/subscribers/<int:subscriber_id>/delete", methods=["POST"])
    @login_required
    def delete_subscriber(subscriber_id):
        validate_csrf()
        subscriber = owned_subscriber_or_404(subscriber_id)
        execute("DELETE FROM subscribers WHERE id = ? AND user_id = ?", (subscriber["id"], g.user["id"]))
        flash("Subscriber deleted.", "success")
        return redirect(url_for("dashboard"))

    @app.route("/drafts/new", methods=["GET", "POST"])
    @login_required
    def new_draft():
        if request.method == "POST":
            validate_csrf()
            subject, body, errors = validate_draft_form()
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("draft_form.html", draft=None, subject=subject, body=body), 400
            execute(
                "INSERT INTO drafts (user_id, subject, body) VALUES (?, ?, ?)",
                (g.user["id"], subject, body),
            )
            flash("Draft created.", "success")
            return redirect(url_for("dashboard"))
        return render_template("draft_form.html", draft=None, subject="", body="")

    @app.route("/drafts/<int:draft_id>", methods=["GET", "POST"])
    @login_required
    def edit_draft(draft_id):
        draft = owned_draft_or_404(draft_id)
        if request.method == "POST":
            validate_csrf()
            subject, body, errors = validate_draft_form()
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("draft_form.html", draft=draft, subject=subject, body=body), 400
            execute(
                "UPDATE drafts SET subject = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
                (subject, body, draft["id"], g.user["id"]),
            )
            flash("Draft saved.", "success")
            return redirect(url_for("edit_draft", draft_id=draft["id"]))
        return render_template("draft_form.html", draft=draft, subject=draft["subject"], body=draft["body"])

    @app.route("/drafts/<int:draft_id>/preview")
    @login_required
    def preview_draft(draft_id):
        draft = owned_draft_or_404(draft_id)
        active_count = query_one(
            "SELECT COUNT(*) AS total FROM subscribers WHERE user_id = ? AND active = 1",
            (g.user["id"],),
        )["total"]
        return render_template("preview.html", draft=draft, body_html=render_newsletter_body(draft["body"]), active_count=active_count)

    @app.route("/drafts/<int:draft_id>/delete", methods=["POST"])
    @login_required
    def delete_draft(draft_id):
        draft = owned_draft_or_404(draft_id)
        validate_csrf()
        execute("DELETE FROM drafts WHERE id = ? AND user_id = ?", (draft["id"], g.user["id"]))
        flash("Draft deleted.", "success")
        return redirect(url_for("dashboard"))

    @app.context_processor
    def inject_helpers():
        return {"csrf_token": csrf_token}

    init_db()
    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


def init_db():
    connection = sqlite3.connect(DATABASE)
    try:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS subscribers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                email TEXT NOT NULL,
                name TEXT NOT NULL DEFAULT '',
                active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
                UNIQUE (user_id, email)
            );
            CREATE TABLE IF NOT EXISTS drafts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                subject TEXT NOT NULL,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );
            """
        )
        connection.commit()
    finally:
        connection.close()


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    db.execute(sql, params)
    db.commit()


def login_required(view):
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    wrapped_view.__name__ = view.__name__
    return wrapped_view


def csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf():
    token = session.get("csrf_token")
    submitted = request.form.get("csrf_token", "")
    if not token or not submitted or not secrets.compare_digest(token, submitted):
        abort(400)


def verify_password(stored_hash, password):
    try:
        return ph.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, TypeError):
        return False


def clean_text(value, max_length):
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "").strip()
    return text[:max_length]


def clean_email(value):
    return clean_text(value, 254).lower()


def valid_email(value):
    name, address = parseaddr(value)
    return bool(address and address == value and len(value) <= 254 and re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", value))


def validate_editor(email, password):
    errors = []
    if not valid_email(email):
        errors.append("Enter a valid editor email address.")
    if len(password) < 12:
        errors.append("Use a password of at least 12 characters.")
    if len(password) > 256:
        errors.append("Password is too long.")
    return errors


def validate_draft_form():
    subject = clean_text(request.form.get("subject", ""), 140)
    body = clean_text(request.form.get("body", ""), 10000)
    errors = []
    if not subject:
        errors.append("Subject is required.")
    if not body:
        errors.append("Body is required.")
    if len(request.form.get("subject", "")) > 140:
        errors.append("Subject must be 140 characters or fewer.")
    if len(request.form.get("body", "")) > 10000:
        errors.append("Body must be 10,000 characters or fewer.")
    return subject, body, errors


def owned_subscriber_or_404(subscriber_id):
    subscriber = query_one(
        "SELECT id, user_id FROM subscribers WHERE id = ? AND user_id = ?",
        (subscriber_id, g.user["id"]),
    )
    if subscriber is None:
        abort(404)
    return subscriber


def owned_draft_or_404(draft_id):
    draft = query_one(
        "SELECT id, user_id, subject, body, created_at, updated_at FROM drafts WHERE id = ? AND user_id = ?",
        (draft_id, g.user["id"]),
    )
    if draft is None:
        abort(404)
    return draft


def render_newsletter_body(body):
    paragraphs = []
    for block in body.splitlines():
        block = block.strip()
        if block:
            paragraphs.append(f"<p>{escape(block)}</p>")
    return Markup("\n".join(paragraphs))


app = create_app()
app.teardown_appcontext(close_db)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5049)
