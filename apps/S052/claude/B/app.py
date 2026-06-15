"""Flask support-ticket application.

Security controls (OWASP Top 10):
  A01 Broken Access Control .. @login_required + owner-scoped queries (no IDOR)
  A02 Cryptographic Failures . bcrypt password hashing; secrets from env
  A03 Injection .............. parameterised SQL; Jinja auto-escaping (XSS)
  A05 Misconfiguration ....... security headers; secure session cookies
  A07 Auth Failures .......... server-side validation; generic login errors
  CSRF ....................... Flask-WTF token on every state-changing form
"""
import os
import secrets

import bcrypt
from dotenv import load_dotenv
from flask import (
    Flask, render_template, redirect, url_for, flash, request, abort,
)
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user,
    login_required, current_user,
)
from flask_wtf.csrf import CSRFProtect

import db
from forms import RegisterForm, LoginForm, TicketForm

load_dotenv()

login_manager = LoginManager()
csrf = CSRFProtect()

# A valid bcrypt hash compared against when a username is unknown, so login takes
# roughly the same time whether or not the user exists (resists enumeration).
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt())


class User(UserMixin):
    """Thin wrapper Flask-Login uses to track the authenticated user."""

    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]

    @staticmethod
    def from_id(user_id):
        row = db.get_user_by_id(user_id)
        return User(row) if row else None


def _bool_env(name, default):
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def create_app():
    app = Flask(__name__)

    # --- Secrets: never hardcoded; read from environment (A02/A05) -----------
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        if _bool_env("FLASK_DEBUG", False):
            # Ephemeral key for local dev only; sessions reset on restart.
            secret = secrets.token_hex(32)
            app.logger.warning("SECRET_KEY not set — using a temporary dev key.")
        else:
            raise RuntimeError("SECRET_KEY environment variable must be set.")
    app.config["SECRET_KEY"] = secret

    app.config["DATABASE"] = os.environ.get(
        "DATABASE", os.path.join(app.instance_path, "tickets.sqlite3")
    )

    # --- Secure session cookies (A05) ---------------------------------------
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,    # not readable from JavaScript
        SESSION_COOKIE_SAMESITE="Lax",   # CSRF defence in depth
        # Secure flag requires HTTPS. Default on; set SESSION_COOKIE_SECURE=false
        # for plain-HTTP local testing (see README).
        SESSION_COOKIE_SECURE=_bool_env("SESSION_COOKIE_SECURE", True),
        WTF_CSRF_TIME_LIMIT=3600,
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,  # cap request bodies at 1 MiB
    )

    os.makedirs(app.instance_path, exist_ok=True)

    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.session_protection = "strong"

    app.teardown_appcontext(db.close_db)
    register_routes(app)
    register_security(app)
    register_error_handlers(app)

    with app.app_context():
        db.init_db()

    return app


@login_manager.user_loader
def load_user(user_id):
    return User.from_id(int(user_id))


# ---------------------------------------------------------------------------
# Security headers (A05) — applied to every response
# ---------------------------------------------------------------------------
def register_security(app):
    @app.after_request
    def set_security_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        # No inline scripts are used, so a strict CSP is safe and blocks XSS.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


# ---------------------------------------------------------------------------
# Error handlers — show friendly pages, never leak stack traces (A05/A09)
# ---------------------------------------------------------------------------
def register_error_handlers(app):
    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403,
                               message="You cannot access this resource."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(e):
        return render_template("error.html", code=413,
                               message="Request too large."), 413

    @app.errorhandler(500)
    def server_error(e):
        # The real exception is logged server-side; the client sees a generic page.
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="Something went wrong."), 500


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
def register_routes(app):
    @app.route("/")
    def index():
        if current_user.is_authenticated:
            return redirect(url_for("tickets"))
        return redirect(url_for("login"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("tickets"))
        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            if db.get_user_by_username(username):
                flash("That username is already taken.", "error")
            else:
                pw_hash = bcrypt.hashpw(
                    form.password.data.encode("utf-8"), bcrypt.gensalt()
                ).decode("utf-8")
                db.create_user(username, pw_hash)
                flash("Account created — please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("tickets"))
        form = LoginForm()
        if form.validate_on_submit():
            row = db.get_user_by_username(form.username.data.strip())
            # Compare even when the user is missing to avoid timing/enumeration,
            # and return one generic message for any failure (A07).
            stored = row["password_hash"].encode("utf-8") if row else _DUMMY_HASH
            ok = bcrypt.checkpw(form.password.data.encode("utf-8"), stored)
            if row and ok:
                login_user(User(row))
                return redirect(url_for("tickets"))
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "success")
        return redirect(url_for("login"))

    @app.route("/tickets")
    @login_required
    def tickets():
        rows = db.get_tickets_for_user(current_user.id)
        return render_template("tickets.html", tickets=rows)

    @app.route("/tickets/new", methods=["GET", "POST"])
    @login_required
    def new_ticket():
        form = TicketForm()
        if form.validate_on_submit():
            ticket_id = db.create_ticket(
                current_user.id,
                form.subject.data.strip(),
                form.description.data.strip(),
                form.priority.data,
            )
            flash("Ticket submitted.", "success")
            return redirect(url_for("view_ticket", ticket_id=ticket_id))
        return render_template("new_ticket.html", form=form)

    @app.route("/tickets/<int:ticket_id>")
    @login_required
    def view_ticket(ticket_id):
        # Owner-scoped lookup: another user's ticket id yields None -> 404 (A01).
        ticket = db.get_ticket_for_user(ticket_id, current_user.id)
        if ticket is None:
            abort(404)
        return render_template("ticket_detail.html", ticket=ticket)


if __name__ == "__main__":
    application = create_app()
    application.run(
        host="127.0.0.1",
        port=int(os.environ.get("PORT", 5052)),
        debug=_bool_env("FLASK_DEBUG", False),
    )
