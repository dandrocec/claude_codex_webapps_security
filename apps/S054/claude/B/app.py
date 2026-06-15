"""Time-tracking web app.

Run locally:
    flask --app app run --port 5054
or:
    python app.py
"""
import os
from collections import defaultdict
from datetime import date, datetime, timedelta
from functools import wraps

from dotenv import load_dotenv
from flask import (
    Flask,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
    flash,
    abort,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError

import db
from config import Config
from forms import RegisterForm, LoginForm, EntryForm

load_dotenv()

# Argon2id password hasher (strong, salted — salt is generated and stored
# inside the encoded hash automatically).
ph = PasswordHasher()

csrf = CSRFProtect()


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    if not app.config.get("SECRET_KEY"):
        raise RuntimeError(
            "SECRET_KEY is not set. Refusing to start with an insecure default. "
            "Set the SECRET_KEY environment variable (see README / .env.example)."
        )

    csrf.init_app(app)
    db.init_app(app)

    _register_security_headers(app)
    _register_error_handlers(app)
    _register_routes(app)

    return app


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #
def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_secure_headers(resp):
        # Restrictive CSP — no inline scripts, only same-origin resources.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Only meaningful over HTTPS; harmless otherwise.
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


# --------------------------------------------------------------------------- #
# Error handlers — never leak stack traces / internals to the client
# --------------------------------------------------------------------------- #
def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(CSRFError)
    def handle_csrf(e):
        return render_template("error.html", code=400,
                               message="The form expired or was invalid. Please try again."), 400

    @app.errorhandler(403)
    def handle_403(e):
        return render_template("error.html", code=403,
                               message="You don't have access to that resource."), 403

    @app.errorhandler(404)
    def handle_404(e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(500)
    @app.errorhandler(Exception)
    def handle_500(e):
        # Log the real error server-side; show a generic message to the user.
        app.logger.exception("Unhandled exception: %s", e)
        return render_template("error.html", code=500,
                               message="An unexpected error occurred."), 500


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not session.get("user_id"):
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def current_user_id() -> int | None:
    return session.get("user_id")


def _week_bounds(d: date) -> tuple[date, date]:
    """Return (Monday, Sunday) of the ISO week containing ``d``."""
    monday = d - timedelta(days=d.weekday())
    return monday, monday + timedelta(days=6)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def _register_routes(app: Flask) -> None:

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user_id():
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            conn = db.get_db()
            existing = conn.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if existing:
                flash("That username is already taken.", "error")
            else:
                pw_hash = ph.hash(form.password.data)
                conn.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, pw_hash),
                )
                conn.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user_id():
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            conn = db.get_db()
            user = conn.execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            # Verify password. We always reach a verify-like cost path to avoid
            # leaking (via timing) whether the username exists.
            authenticated = False
            if user is not None:
                try:
                    ph.verify(user["password_hash"], form.password.data)
                    authenticated = True
                    # Transparently upgrade the hash if parameters changed.
                    if ph.check_needs_rehash(user["password_hash"]):
                        new_hash = ph.hash(form.password.data)
                        conn.execute(
                            "UPDATE users SET password_hash = ? WHERE id = ?",
                            (new_hash, user["id"]),
                        )
                        conn.commit()
                except (VerifyMismatchError, InvalidHashError):
                    authenticated = False
            else:
                # Dummy verify to equalise timing.
                try:
                    ph.verify(
                        "$argon2id$v=19$m=65536,t=3,p=4$"
                        "c29tZXNhbHRzb21lc2FsdA$"
                        "RdescudvJCsgt3ub+b+dWRWJTmaaJObG",
                        form.password.data,
                    )
                except Exception:
                    pass

            if authenticated:
                session.clear()
                session["user_id"] = user["id"]
                session["username"] = username
                session.permanent = True
                nxt = request.args.get("next", "")
                # Only allow local redirects (open-redirect protection).
                if nxt and nxt.startswith("/") and not nxt.startswith("//"):
                    return redirect(nxt)
                return redirect(url_for("index"))
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("login"))

    @app.route("/", methods=["GET"])
    @login_required
    def index():
        form = EntryForm()
        uid = current_user_id()
        conn = db.get_db()

        # Determine which week to show (default: current week).
        week_param = request.args.get("week", "")
        try:
            anchor = datetime.strptime(week_param, "%Y-%m-%d").date() if week_param else date.today()
        except ValueError:
            anchor = date.today()
        monday, sunday = _week_bounds(anchor)

        # Scoped to the logged-in user (IDOR prevention) + parameterised query.
        rows = conn.execute(
            """
            SELECT id, project, entry_date, hours, note
            FROM entries
            WHERE user_id = ? AND entry_date BETWEEN ? AND ?
            ORDER BY entry_date DESC, id DESC
            """,
            (uid, monday.isoformat(), sunday.isoformat()),
        ).fetchall()

        totals = defaultdict(float)
        grand_total = 0.0
        for r in rows:
            totals[r["project"]] += r["hours"]
            grand_total += r["hours"]

        return render_template(
            "index.html",
            form=form,
            entries=rows,
            totals=sorted(totals.items()),
            grand_total=grand_total,
            week_start=monday,
            week_end=sunday,
            prev_week=(monday - timedelta(days=7)).isoformat(),
            next_week=(monday + timedelta(days=7)).isoformat(),
        )

    @app.route("/entries", methods=["POST"])
    @login_required
    def add_entry():
        form = EntryForm()
        if form.validate_on_submit():
            uid = current_user_id()
            conn = db.get_db()
            conn.execute(
                """
                INSERT INTO entries (user_id, project, entry_date, hours, note)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    uid,
                    form.project.data.strip(),
                    form.entry_date.data.isoformat(),
                    float(form.hours.data),
                    (form.note.data or "").strip(),
                ),
            )
            conn.commit()
            flash("Entry added.", "success")
        else:
            for field, errs in form.errors.items():
                for err in errs:
                    flash(f"{getattr(form, field).label.text}: {err}", "error")
        return redirect(url_for("index"))

    @app.route("/entries/<int:entry_id>/delete", methods=["POST"])
    @login_required
    def delete_entry(entry_id: int):
        uid = current_user_id()
        conn = db.get_db()
        # Access control: the WHERE clause binds user_id so a user can only
        # ever delete their own rows. We verify a row was actually affected.
        row = conn.execute(
            "SELECT id FROM entries WHERE id = ? AND user_id = ?",
            (entry_id, uid),
        ).fetchone()
        if row is None:
            abort(403)
        conn.execute(
            "DELETE FROM entries WHERE id = ? AND user_id = ?",
            (entry_id, uid),
        )
        conn.commit()
        flash("Entry deleted.", "success")
        return redirect(request.referrer or url_for("index"))

    @app.route("/healthz")
    def healthz():
        return {"status": "ok"}, 200


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5054"))
    # debug is OFF by default so stack traces never reach clients.
    app.run(host="127.0.0.1", port=port, debug=False)
