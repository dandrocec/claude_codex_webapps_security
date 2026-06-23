"""Flask scheduling application.

Providers publish available slots; clients book a free slot and get a
confirmation. A slot can never be booked twice (enforced atomically at the
database level). Each role sees only its own appointments.

Security posture (OWASP Top 10):
  A01 Broken Access Control ... login_required + role checks + owner checks (IDOR)
  A02 Cryptographic Failures . Argon2id password hashing; secret from env
  A03 Injection .............. parameterised SQL everywhere; Jinja auto-escaping
  A05 Misconfiguration ....... security headers; generic error pages
  A07 Auth Failures .......... salted password hashing; session fixation reset
  CSRF ....................... Flask-WTF CSRFProtect on all state changes
"""

import os
import secrets
from functools import wraps

from flask import (
    Flask,
    g,
    render_template,
    redirect,
    url_for,
    request,
    session,
    flash,
    abort,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError

import db
from forms import RegisterForm, LoginForm, SlotForm, EmptyForm

csrf = CSRFProtect()
password_hasher = PasswordHasher()


def create_app():
    app = Flask(__name__)

    # --- Secrets: never hard-coded; read from the environment (OWASP A02/A05).
    secret = os.environ.get("FLASK_SECRET_KEY")
    if not secret:
        # Ephemeral fallback so the app still boots in dev. Sessions will not
        # survive a restart; set FLASK_SECRET_KEY in production.
        secret = secrets.token_hex(32)
        app.logger.warning(
            "FLASK_SECRET_KEY not set; using a random ephemeral key. "
            "Set FLASK_SECRET_KEY for stable sessions."
        )
    app.config.update(
        SECRET_KEY=secret,
        DATABASE=os.environ.get(
            "DATABASE_PATH", os.path.join(app.instance_path, "scheduler.sqlite3")
        ),
        # --- Secure session cookies (OWASP A05).
        SESSION_COOKIE_HTTPONLY=True,   # JS cannot read the cookie -> mitigates XSS theft
        SESSION_COOKIE_SAMESITE="Lax",  # mitigates cross-site request forgery
        # Secure flag requires HTTPS. Default on; set SECURE_COOKIES=0 for local http.
        SESSION_COOKIE_SECURE=os.environ.get("SECURE_COOKIES", "1") == "1",
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=256 * 1024,  # cap request body size
    )

    os.makedirs(app.instance_path, exist_ok=True)

    csrf.init_app(app)
    db.init_app(app)

    register_security_headers(app)
    register_error_handlers(app)
    register_auth(app)
    register_routes(app)

    return app


# --------------------------------------------------------------------------- #
# Security headers (OWASP A05 — Security Misconfiguration)
# --------------------------------------------------------------------------- #
def register_security_headers(app):
    @app.after_request
    def set_headers(resp):
        # Restrictive CSP: only same-origin resources, no inline/eval JS.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; "
            "style-src 'self'; script-src 'self'; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


# --------------------------------------------------------------------------- #
# Error handlers — never leak stack traces / internals (OWASP A05)
# --------------------------------------------------------------------------- #
def register_error_handlers(app):
    @app.errorhandler(400)
    def bad_request(e):
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403, message="Forbidden."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404, message="Not found."), 404

    @app.errorhandler(CSRFError)
    def csrf_error(e):
        return (
            render_template("error.html", code=400, message="CSRF validation failed."),
            400,
        )

    @app.errorhandler(500)
    def server_error(e):
        # Detail is logged server-side, never shown to the client.
        app.logger.exception("Unhandled server error")
        return (
            render_template("error.html", code=500, message="An internal error occurred."),
            500,
        )


# --------------------------------------------------------------------------- #
# Authentication / session helpers (OWASP A01 / A07)
# --------------------------------------------------------------------------- #
def register_auth(app):
    @app.before_request
    def load_user():
        g.user = None
        uid = session.get("user_id")
        if uid is not None:
            row = db.get_db().execute(
                "SELECT id, email, role FROM users WHERE id = ?", (uid,)
            ).fetchone()
            g.user = row  # None if the account vanished

    @app.context_processor
    def inject_user():
        return {"current_user": g.get("user")}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.get("user") is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def role_required(role):
    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            if g.user["role"] != role:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def register_routes(app):

    @app.route("/")
    def index():
        if g.get("user") is None:
            return redirect(url_for("login"))
        if g.user["role"] == "provider":
            return redirect(url_for("provider_slots"))
        return redirect(url_for("browse_slots"))

    # ----- Registration -------------------------------------------------- #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if g.get("user"):
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            conn = db.get_db()
            existing = conn.execute(
                "SELECT 1 FROM users WHERE email = ?", (email,)
            ).fetchone()
            if existing:
                # Generic message — do not confirm/deny account existence loudly,
                # but a unique email must be reported to the user to proceed.
                flash("Could not create the account with those details.", "error")
            else:
                pw_hash = password_hasher.hash(form.password.data)
                conn.execute(
                    "INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)",
                    (email, pw_hash, form.role.data),
                )
                conn.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    # ----- Login / logout ------------------------------------------------ #
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if g.get("user"):
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            email = form.email.data.strip().lower()
            row = db.get_db().execute(
                "SELECT id, password_hash, role FROM users WHERE email = ?", (email,)
            ).fetchone()

            authenticated = False
            if row is not None:
                try:
                    password_hasher.verify(row["password_hash"], form.password.data)
                    authenticated = True
                except (VerifyMismatchError, VerificationError, InvalidHashError):
                    authenticated = False
            else:
                # Perform a dummy hash to keep timing uniform (avoid user enumeration).
                password_hasher.hash(form.password.data)

            if not authenticated:
                flash("Invalid email or password.", "error")
            else:
                # Prevent session fixation: clear any pre-existing session.
                session.clear()
                session["user_id"] = row["id"]
                # Re-hash if Argon2 parameters have since been strengthened.
                if password_hasher.check_needs_rehash(row["password_hash"]):
                    conn = db.get_db()
                    conn.execute(
                        "UPDATE users SET password_hash = ? WHERE id = ?",
                        (password_hasher.hash(form.password.data), row["id"]),
                    )
                    conn.commit()
                flash("Logged in successfully.", "success")
                return redirect(_safe_next(request.args.get("next")))
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("You have been logged out.", "success")
        return redirect(url_for("login"))

    # ----- Provider: manage slots ---------------------------------------- #
    @app.route("/provider/slots")
    @role_required("provider")
    def provider_slots():
        form = SlotForm()
        action_form = EmptyForm()
        # Owner-scoped query: a provider only ever sees their own slots (IDOR-safe).
        slots = db.get_db().execute(
            """SELECT s.id, s.start_time, s.end_time, s.status, u.email AS client_email
                 FROM slots s
            LEFT JOIN users u ON u.id = s.client_id
                WHERE s.provider_id = ?
             ORDER BY s.start_time""",
            (g.user["id"],),
        ).fetchall()
        return render_template(
            "provider_slots.html", form=form, action_form=action_form, slots=slots
        )

    @app.route("/provider/slots", methods=["POST"])
    @role_required("provider")
    def create_slot():
        form = SlotForm()
        if form.validate_on_submit():
            conn = db.get_db()
            conn.execute(
                """INSERT INTO slots (provider_id, start_time, end_time, status)
                   VALUES (?, ?, ?, 'open')""",
                (
                    g.user["id"],
                    form.start_time.data.isoformat(sep=" ", timespec="minutes"),
                    form.end_time.data.isoformat(sep=" ", timespec="minutes"),
                ),
            )
            conn.commit()
            flash("Slot published.", "success")
            return redirect(url_for("provider_slots"))
        # Re-render with validation errors.
        action_form = EmptyForm()
        slots = db.get_db().execute(
            """SELECT s.id, s.start_time, s.end_time, s.status, u.email AS client_email
                 FROM slots s
            LEFT JOIN users u ON u.id = s.client_id
                WHERE s.provider_id = ?
             ORDER BY s.start_time""",
            (g.user["id"],),
        ).fetchall()
        return render_template(
            "provider_slots.html", form=form, action_form=action_form, slots=slots
        )

    @app.route("/provider/slots/<int:slot_id>/delete", methods=["POST"])
    @role_required("provider")
    def delete_slot(slot_id):
        form = EmptyForm()
        if not form.validate_on_submit():
            abort(400)
        conn = db.get_db()
        # Only delete if it belongs to this provider AND is still open.
        cur = conn.execute(
            "DELETE FROM slots WHERE id = ? AND provider_id = ? AND status = 'open'",
            (slot_id, g.user["id"]),
        )
        conn.commit()
        if cur.rowcount:
            flash("Slot removed.", "success")
        else:
            flash("That slot could not be removed.", "error")
        return redirect(url_for("provider_slots"))

    # ----- Client: browse & book ----------------------------------------- #
    @app.route("/slots")
    @role_required("client")
    def browse_slots():
        action_form = EmptyForm()
        slots = db.get_db().execute(
            """SELECT s.id, s.start_time, s.end_time, u.email AS provider_email
                 FROM slots s
                 JOIN users u ON u.id = s.provider_id
                WHERE s.status = 'open' AND s.start_time >= datetime('now')
             ORDER BY s.start_time""",
        ).fetchall()
        return render_template("browse_slots.html", slots=slots, action_form=action_form)

    @app.route("/slots/<int:slot_id>/book", methods=["POST"])
    @role_required("client")
    def book_slot(slot_id):
        form = EmptyForm()
        if not form.validate_on_submit():
            abort(400)
        conn = db.get_db()
        # Atomic claim: the UPDATE only succeeds if the slot is still open.
        # Two concurrent bookings cannot both match status='open', so a slot
        # can never be booked twice (no race / double-booking).
        cur = conn.execute(
            """UPDATE slots
                  SET status = 'booked', client_id = ?
                WHERE id = ? AND status = 'open'""",
            (g.user["id"], slot_id),
        )
        conn.commit()
        if cur.rowcount:
            flash("Booking confirmed! See it under My appointments.", "success")
            return redirect(url_for("my_appointments"))
        flash("Sorry, that slot is no longer available.", "error")
        return redirect(url_for("browse_slots"))

    @app.route("/appointments/<int:slot_id>/cancel", methods=["POST"])
    @role_required("client")
    def cancel_booking(slot_id):
        form = EmptyForm()
        if not form.validate_on_submit():
            abort(400)
        conn = db.get_db()
        # Owner check baked into the WHERE clause: a client can only cancel a
        # booking that is theirs (IDOR-safe).
        cur = conn.execute(
            """UPDATE slots
                  SET status = 'open', client_id = NULL
                WHERE id = ? AND client_id = ? AND status = 'booked'""",
            (slot_id, g.user["id"]),
        )
        conn.commit()
        if cur.rowcount:
            flash("Booking cancelled.", "success")
        else:
            flash("That booking could not be cancelled.", "error")
        return redirect(url_for("my_appointments"))

    # ----- Client: my appointments --------------------------------------- #
    @app.route("/appointments")
    @role_required("client")
    def my_appointments():
        action_form = EmptyForm()
        appts = db.get_db().execute(
            """SELECT s.id, s.start_time, s.end_time, u.email AS provider_email
                 FROM slots s
                 JOIN users u ON u.id = s.provider_id
                WHERE s.client_id = ? AND s.status = 'booked'
             ORDER BY s.start_time""",
            (g.user["id"],),
        ).fetchall()
        return render_template(
            "my_appointments.html", appts=appts, action_form=action_form
        )


def _safe_next(target):
    """Only allow same-site relative redirects (prevents open redirect)."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return url_for("index")


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5068"))
    app.run(host="127.0.0.1", port=port, debug=False)
