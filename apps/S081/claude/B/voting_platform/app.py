"""Flask voting platform.

Security controls applied (OWASP Top 10):
  * SQL injection .......... parameterised queries everywhere (see db.py).
  * Broken auth ............ Argon2id password hashing, server-side sessions.
  * Sensitive data ......... secrets read from environment, never hardcoded.
  * XSS .................... Jinja2 auto-escaping + input validation.
  * CSRF ................... Flask-WTF CSRFProtect on every state-changing POST.
  * Access control / IDOR .. user identity taken from the session, never from
                             the request body; admin-only routes guarded.
  * Security misconfig ..... secure session cookies + security headers.
  * Error handling ......... generic error pages, no stack traces to clients.
"""
import os
import functools
from datetime import datetime, timezone

from flask import (
    Flask, g, render_template, request, redirect, url_for, session,
    flash, abort,
)
from flask_wtf import FlaskForm, CSRFProtect
from wtforms import (
    StringField, PasswordField, TextAreaField, DateTimeLocalField,
    RadioField,
)
from wtforms.validators import (
    DataRequired, Length, Regexp, EqualTo, ValidationError,
)
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHash

import db as database

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:  # python-dotenv is optional at runtime
    pass

ph = PasswordHasher()
csrf = CSRFProtect()

DATETIME_FMT = "%Y-%m-%d %H:%M:%S"


# --------------------------------------------------------------------------- #
# Forms (WTForms gives us validation + CSRF tokens for free)
# --------------------------------------------------------------------------- #
class RegisterForm(FlaskForm):
    username = StringField("Username", validators=[
        DataRequired(),
        Length(min=3, max=32),
        # Allow-list of characters: blocks injection/控制 chars at the door.
        Regexp(r"^[A-Za-z0-9_.-]+$",
               message="Use letters, numbers, and _ . - only."),
    ])
    password = PasswordField("Password", validators=[
        DataRequired(),
        Length(min=8, max=128),
    ])
    confirm = PasswordField("Confirm password", validators=[
        DataRequired(),
        EqualTo("password", message="Passwords must match."),
    ])


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])


class ElectionForm(FlaskForm):
    title = StringField("Title", validators=[DataRequired(), Length(min=3, max=200)])
    description = TextAreaField("Description", validators=[Length(max=2000)])
    # Accept the datetime-local value with or without seconds.
    open_at = DateTimeLocalField(
        "Opens at (UTC)", format=["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"],
        validators=[DataRequired()])
    close_at = DateTimeLocalField(
        "Closes at (UTC)", format=["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"],
        validators=[DataRequired()])
    # One candidate per non-empty line.
    candidates = TextAreaField("Candidates (one per line)",
                               validators=[DataRequired(), Length(max=4000)])

    def validate_close_at(self, field):
        if self.open_at.data and field.data and field.data <= self.open_at.data:
            raise ValidationError("Close time must be after open time.")


class VoteForm(FlaskForm):
    candidate_id = RadioField("Candidate", validators=[DataRequired()])


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def now_utc():
    return datetime.now(timezone.utc)


def parse_db_time(value):
    """Parse a stored UTC timestamp string into an aware datetime."""
    return datetime.strptime(value, DATETIME_FMT).replace(tzinfo=timezone.utc)


def current_user():
    if "user_id" not in session:
        return None
    if "user" not in g:
        row = database.get_db().execute(
            "SELECT id, username, is_admin FROM users WHERE id = ?",
            (session["user_id"],),
        ).fetchone()
        g.user = row
    return g.user


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def admin_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return redirect(url_for("login"))
        if not user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)
    return wrapped


def election_status(election, ref=None):
    ref = ref or now_utc()
    if ref < parse_db_time(election["open_at"]):
        return "upcoming"
    if ref > parse_db_time(election["close_at"]):
        return "closed"
    return "open"


# --------------------------------------------------------------------------- #
# Application factory
# --------------------------------------------------------------------------- #
def create_app():
    app = Flask(__name__)

    is_production = os.environ.get("FLASK_ENV") == "production"

    secret = os.environ.get("SECRET_KEY")
    if not secret:
        if is_production:
            raise RuntimeError("SECRET_KEY environment variable is required.")
        # Dev fallback only — never used when FLASK_ENV=production.
        secret = "dev-only-insecure-key-set-SECRET_KEY-in-prod"

    # Secure cookies are ON by default in production and OFF in development so
    # local plain-HTTP testing works out of the box. Override with COOKIE_SECURE.
    cookie_secure_default = "1" if is_production else "0"
    app.config.update(
        SECRET_KEY=secret,
        # Secure session cookie configuration.
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", cookie_secure_default) == "1",
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=256 * 1024,  # cap request body size
    )

    csrf.init_app(app)
    database.init_app(app)

    with app.app_context():
        database.init_db()
        _bootstrap_admin()

    _register_routes(app)
    _register_security_headers(app)
    _register_error_handlers(app)
    return app


def _bootstrap_admin():
    """Create an initial admin from env vars if one does not yet exist."""
    username = os.environ.get("ADMIN_USERNAME")
    password = os.environ.get("ADMIN_PASSWORD")
    if not username or not password:
        return
    db = database.get_db()
    existing = db.execute(
        "SELECT id FROM users WHERE username = ?", (username,)
    ).fetchone()
    if existing:
        return
    db.execute(
        "INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)",
        (username, ph.hash(password)),
    )
    db.commit()


def _register_security_headers(app):
    @app.after_request
    def set_secure_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "base-uri 'none'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


def _register_error_handlers(app):
    # Generic pages — never expose stack traces or internal details.
    @app.errorhandler(400)
    def bad_request(e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403,
                               message="You do not have access to that."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="Something went wrong."), 500


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def _register_routes(app):

    @app.context_processor
    def inject_user():
        return {"current_user": current_user()}

    @app.route("/")
    def index():
        db = database.get_db()
        elections = db.execute(
            "SELECT id, title, description, open_at, close_at "
            "FROM elections ORDER BY close_at DESC"
        ).fetchall()
        items = [
            {"e": e, "status": election_status(e)} for e in elections
        ]
        return render_template("index.html", items=items)

    # ----- Auth ---------------------------------------------------------- #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user():
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            db = database.get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (form.username.data, ph.hash(form.password.data)),
                )
                db.commit()
            except database.sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
                return render_template("register.html", form=form)
            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user():
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            db = database.get_db()
            row = db.execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (form.username.data,),
            ).fetchone()
            # Verify even when the user is missing to limit timing oracles.
            stored = row["password_hash"] if row else (
                "$argon2id$v=19$m=65536,t=3,p=4$"
                "c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000"
            )
            valid = False
            try:
                ph.verify(stored, form.password.data)
                valid = row is not None
            except (VerifyMismatchError, InvalidHash):
                valid = False
            if not valid:
                flash("Invalid username or password.", "error")
                return render_template("login.html", form=form)
            # Prevent session fixation: start a fresh session on login.
            session.clear()
            session["user_id"] = row["id"]
            # Optionally rehash if parameters changed.
            if ph.check_needs_rehash(stored):
                db.execute("UPDATE users SET password_hash = ? WHERE id = ?",
                           (ph.hash(form.password.data), row["id"]))
                db.commit()
            dest = request.args.get("next", "")
            # Open-redirect guard: only allow local relative paths.
            if not dest.startswith("/") or dest.startswith("//"):
                dest = url_for("index")
            return redirect(dest)
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    # ----- Admin: create election --------------------------------------- #
    @app.route("/admin/elections/new", methods=["GET", "POST"])
    @admin_required
    def create_election():
        form = ElectionForm()
        if form.validate_on_submit():
            names = [
                line.strip()
                for line in form.candidates.data.splitlines()
                if line.strip()
            ]
            if len(names) < 2:
                flash("Provide at least two candidates.", "error")
                return render_template("create_election.html", form=form)
            if len(names) > 50:
                flash("Too many candidates (max 50).", "error")
                return render_template("create_election.html", form=form)

            db = database.get_db()
            cur = db.execute(
                "INSERT INTO elections (title, description, open_at, close_at, "
                "created_by) VALUES (?, ?, ?, ?, ?)",
                (
                    form.title.data,
                    form.description.data or "",
                    form.open_at.data.strftime(DATETIME_FMT),
                    form.close_at.data.strftime(DATETIME_FMT),
                    current_user()["id"],
                ),
            )
            election_id = cur.lastrowid
            db.executemany(
                "INSERT INTO candidates (election_id, name) VALUES (?, ?)",
                [(election_id, name) for name in names],
            )
            db.commit()
            flash("Election created.", "success")
            return redirect(url_for("view_election", election_id=election_id))
        return render_template("create_election.html", form=form)

    # ----- View / vote --------------------------------------------------- #
    @app.route("/elections/<int:election_id>", methods=["GET", "POST"])
    @login_required
    def view_election(election_id):
        db = database.get_db()
        election = db.execute(
            "SELECT * FROM elections WHERE id = ?", (election_id,)
        ).fetchone()
        if election is None:
            abort(404)

        candidates = db.execute(
            "SELECT id, name FROM candidates WHERE election_id = ? ORDER BY id",
            (election_id,),
        ).fetchall()
        status = election_status(election)
        user = current_user()

        existing_vote = db.execute(
            "SELECT candidate_id FROM votes WHERE election_id = ? AND user_id = ?",
            (election_id, user["id"]),
        ).fetchone()

        form = VoteForm()
        form.candidate_id.choices = [(str(c["id"]), c["name"]) for c in candidates]

        if request.method == "POST":
            if status != "open":
                flash("This election is not open for voting.", "error")
                return redirect(url_for("view_election", election_id=election_id))
            if existing_vote:
                flash("You have already voted in this election.", "error")
                return redirect(url_for("view_election", election_id=election_id))
            if form.validate_on_submit():
                chosen = int(form.candidate_id.data)
                # Confirm the candidate belongs to THIS election (no IDOR).
                belongs = db.execute(
                    "SELECT 1 FROM candidates WHERE id = ? AND election_id = ?",
                    (chosen, election_id),
                ).fetchone()
                if not belongs:
                    abort(400)
                try:
                    db.execute(
                        "INSERT INTO votes (election_id, candidate_id, user_id) "
                        "VALUES (?, ?, ?)",
                        # user_id comes from the session, never from the form.
                        (election_id, chosen, user["id"]),
                    )
                    db.commit()
                except database.sqlite3.IntegrityError:
                    # UNIQUE(election_id, user_id) — race-safe double vote guard.
                    flash("You have already voted in this election.", "error")
                    return redirect(url_for("view_election", election_id=election_id))
                flash("Your vote has been recorded.", "success")
                return redirect(url_for("view_election", election_id=election_id))

        results = None
        if status == "closed":
            results = _tally(db, election_id)

        return render_template(
            "election.html",
            election=election,
            candidates=candidates,
            status=status,
            form=form,
            already_voted=existing_vote is not None,
            voted_for=existing_vote["candidate_id"] if existing_vote else None,
            results=results,
        )

    @app.route("/elections/<int:election_id>/results")
    @login_required
    def results(election_id):
        db = database.get_db()
        election = db.execute(
            "SELECT * FROM elections WHERE id = ?", (election_id,)
        ).fetchone()
        if election is None:
            abort(404)
        # Results are only available after the election has closed.
        if election_status(election) != "closed":
            flash("Results are available after the election closes.", "error")
            return redirect(url_for("view_election", election_id=election_id))
        return render_template(
            "results.html", election=election, results=_tally(db, election_id)
        )


def _tally(db, election_id):
    rows = db.execute(
        "SELECT c.id, c.name, COUNT(v.id) AS votes "
        "FROM candidates c "
        "LEFT JOIN votes v ON v.candidate_id = c.id "
        "WHERE c.election_id = ? "
        "GROUP BY c.id, c.name "
        "ORDER BY votes DESC, c.name ASC",
        (election_id,),
    ).fetchall()
    total = sum(r["votes"] for r in rows)
    return {"rows": rows, "total": total}


app = create_app()

if __name__ == "__main__":
    # Bind to port 5081 as documented in the README.
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="127.0.0.1", port=5081, debug=debug)
