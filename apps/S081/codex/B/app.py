import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps

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
from markupsafe import escape


DATABASE = os.environ.get("DATABASE_URL", "voting.sqlite3")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
NAME_RE = re.compile(r"^[A-Za-z0-9 .,'_-]{1,100}$")


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY", secrets.token_hex(32)),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "true").lower() == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=3600,
        MAX_CONTENT_LENGTH=1024 * 1024,
    )

    @app.before_request
    def load_user_and_protect_csrf():
        g.user = None
        if "user_id" in session:
            g.user = query_one(
                "SELECT id, email, name, is_admin FROM users WHERE id = ?",
                (session["user_id"],),
            )

        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            sent = request.form.get("csrf_token", "")
            expected = session.get("csrf_token", "")
            if not sent or not expected or not secrets.compare_digest(sent, expected):
                abort(400)

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

    @app.context_processor
    def inject_helpers():
        return {
            "csrf_token": csrf_token,
            "format_dt": format_dt,
            "election_is_open": is_open,
            "election_is_closed": is_closed,
        }

    @app.route("/")
    def index():
        elections = query_all(
            """
            SELECT e.id, e.title, e.description, e.opens_at, e.closes_at,
                   (SELECT COUNT(*) FROM votes v WHERE v.election_id = e.id) AS vote_count
            FROM elections e
            ORDER BY e.opens_at DESC
            """
        )
        return render_template("index.html", elections=elections)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            name = clean_text(request.form.get("name", ""), 100)
            email = clean_email(request.form.get("email", ""))
            password = request.form.get("password", "")

            if not email:
                flash("Enter a valid email address.", "error")
            elif not NAME_RE.match(name):
                flash("Use a valid display name with 1-100 safe characters.", "error")
            elif not valid_password(password):
                flash("Password must be at least 12 characters.", "error")
            else:
                try:
                    execute(
                        "INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, 0)",
                        (email, name, hash_password(password)),
                    )
                    flash("Registration complete. Please sign in.", "success")
                    return redirect(url_for("login"))
                except sqlite3.IntegrityError:
                    flash("That email is already registered.", "error")
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            email = clean_email(request.form.get("email", ""))
            password = request.form.get("password", "")
            user = query_one("SELECT * FROM users WHERE email = ?", (email,))
            if user and bcrypt.checkpw(password.encode("utf-8"), user["password_hash"]):
                session.clear()
                session["user_id"] = user["id"]
                session["csrf_token"] = secrets.token_urlsafe(32)
                session.permanent = True
                return redirect(url_for("index"))
            flash("Invalid email or password.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/admin/elections/new", methods=["GET", "POST"])
    @admin_required
    def new_election():
        if request.method == "POST":
            title = clean_text(request.form.get("title", ""), 120)
            description = clean_text(request.form.get("description", ""), 500)
            candidates = [clean_text(c, 100) for c in request.form.getlist("candidates")]
            candidates = [c for c in candidates if c]
            opens_at = parse_local_dt(request.form.get("opens_at", ""))
            closes_at = parse_local_dt(request.form.get("closes_at", ""))

            errors = validate_election(title, candidates, opens_at, closes_at)
            if errors:
                for error in errors:
                    flash(error, "error")
            else:
                with get_db() as db:
                    cur = db.execute(
                        """
                        INSERT INTO elections (title, description, opens_at, closes_at, created_by)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            title,
                            description,
                            opens_at.isoformat(),
                            closes_at.isoformat(),
                            g.user["id"],
                        ),
                    )
                    election_id = cur.lastrowid
                    db.executemany(
                        "INSERT INTO candidates (election_id, name) VALUES (?, ?)",
                        [(election_id, c) for c in candidates],
                    )
                flash("Election created.", "success")
                return redirect(url_for("election_detail", election_id=election_id))
        return render_template("election_form.html")

    @app.route("/elections/<int:election_id>")
    def election_detail(election_id):
        election = get_election_or_404(election_id)
        candidates = query_all(
            "SELECT id, name FROM candidates WHERE election_id = ? ORDER BY id",
            (election_id,),
        )
        user_vote = None
        if g.user:
            user_vote = query_one(
                "SELECT candidate_id FROM votes WHERE election_id = ? AND user_id = ?",
                (election_id, g.user["id"]),
            )
        results = None
        if is_closed(election):
            results = query_all(
                """
                SELECT c.name, COUNT(v.id) AS votes
                FROM candidates c
                LEFT JOIN votes v ON v.candidate_id = c.id
                WHERE c.election_id = ?
                GROUP BY c.id
                ORDER BY votes DESC, c.name ASC
                """,
                (election_id,),
            )
        return render_template(
            "election_detail.html",
            election=election,
            candidates=candidates,
            user_vote=user_vote,
            results=results,
        )

    @app.route("/elections/<int:election_id>/vote", methods=["POST"])
    @login_required
    def vote(election_id):
        election = get_election_or_404(election_id)
        if not is_open(election):
            abort(403)

        candidate_id = request.form.get("candidate_id", type=int)
        candidate = query_one(
            "SELECT id FROM candidates WHERE id = ? AND election_id = ?",
            (candidate_id, election_id),
        )
        if not candidate:
            abort(400)

        try:
            execute(
                "INSERT INTO votes (election_id, candidate_id, user_id) VALUES (?, ?, ?)",
                (election_id, candidate_id, g.user["id"]),
            )
            flash("Vote recorded.", "success")
        except sqlite3.IntegrityError:
            flash("You have already voted in this election.", "error")
        return redirect(url_for("election_detail", election_id=election_id))

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", message="You are not allowed to do that."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", message="Page not found."), 404

    @app.errorhandler(500)
    def internal_error(_error):
        return render_template("error.html", message="An internal error occurred."), 500

    app.teardown_appcontext(close_db)

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


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


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            password_hash BLOB NOT NULL,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS elections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            opens_at TEXT NOT NULL,
            closes_at TEXT NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT
        );

        CREATE TABLE IF NOT EXISTS candidates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
            name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS votes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
            candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (election_id, user_id)
        );
        """
    )
    ensure_admin(db)
    db.commit()


def ensure_admin(db):
    email = os.environ.get("ADMIN_EMAIL")
    password = os.environ.get("ADMIN_PASSWORD")
    name = os.environ.get("ADMIN_NAME", "Election Admin")
    if not email or not password:
        return
    email = clean_email(email)
    if not email:
        return
    if not valid_password(password):
        return
    existing = db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone()
    if existing:
        db.execute("UPDATE users SET is_admin = 1 WHERE email = ?", (email,))
    else:
        db.execute(
            "INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, 1)",
            (email, clean_text(name, 100) or "Election Admin", hash_password(password)),
        )


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not g.user:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def admin_required(view):
    @wraps(view)
    @login_required
    def wrapped(*args, **kwargs):
        if not g.user["is_admin"]:
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def hash_password(password):
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12))


def valid_password(password):
    return isinstance(password, str) and len(password) >= 12 and len(password) <= 256


def clean_email(value):
    email = (value or "").strip().lower()
    if len(email) > 254 or not EMAIL_RE.match(email):
        return ""
    return email


def clean_text(value, max_len):
    text = " ".join((value or "").strip().split())
    return text[:max_len]


def parse_local_dt(value):
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M")
        return parsed.replace(tzinfo=timezone.utc)
    except (TypeError, ValueError):
        return None


def validate_election(title, candidates, opens_at, closes_at):
    errors = []
    if not title or len(title) > 120:
        errors.append("Election title is required and must be 120 characters or fewer.")
    if len(candidates) < 2:
        errors.append("Add at least two candidates.")
    if len(set(c.lower() for c in candidates)) != len(candidates):
        errors.append("Candidate names must be unique.")
    if any(not NAME_RE.match(c) for c in candidates):
        errors.append("Candidate names may contain letters, numbers, spaces, and basic punctuation.")
    if not opens_at or not closes_at:
        errors.append("Open and close times are required.")
    elif closes_at <= opens_at:
        errors.append("Close time must be after open time.")
    return errors


def get_election_or_404(election_id):
    election = query_one("SELECT * FROM elections WHERE id = ?", (election_id,))
    if not election:
        abort(404)
    return election


def now_utc():
    return datetime.now(timezone.utc)


def parse_stored_dt(value):
    return datetime.fromisoformat(value)


def is_open(election):
    current = now_utc()
    return parse_stored_dt(election["opens_at"]) <= current < parse_stored_dt(election["closes_at"])


def is_closed(election):
    return now_utc() >= parse_stored_dt(election["closes_at"])


def format_dt(value):
    try:
        return parse_stored_dt(value).strftime("%Y-%m-%d %H:%M UTC")
    except (TypeError, ValueError):
        return escape(value)


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5081, debug=False)
