"""A small, security-hardened Flask news site.

Authors register/log in and publish articles. Visitors read articles and
post comments. Data is stored in SQLite using only parameterised queries.

Security features (OWASP Top 10 oriented):
  * Parameterised queries everywhere (no string-built SQL) -> SQLi safe.
  * Passwords hashed with bcrypt (salted, adaptive).
  * Jinja2 auto-escaping + server-side input validation -> XSS safe.
  * CSRF protection on every state-changing POST via Flask-WTF.
  * Ownership checks on edit/delete -> IDOR / broken-access-control safe.
  * Hardened session cookies (HttpOnly, SameSite, optional Secure).
  * Security response headers (CSP, X-Content-Type-Options, etc.).
  * Generic error pages; no stack traces or internals leak to clients.
  * Secrets (SECRET_KEY) read from the environment, never hardcoded.
"""

import os
import re
import sqlite3
from datetime import datetime, timezone

import bcrypt
from dotenv import load_dotenv
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
from flask_wtf.csrf import CSRFError

load_dotenv()

# --------------------------------------------------------------------------
# Application configuration
# --------------------------------------------------------------------------
app = Flask(__name__)

SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    # Fail closed rather than silently using a predictable key.
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Copy .env.example to .env and set a strong SECRET_KEY."
    )

app.config.update(
    SECRET_KEY=SECRET_KEY,
    DATABASE=os.environ.get("DATABASE", "news.db"),
    # Hardened session cookie settings.
    SESSION_COOKIE_HTTPONLY=True,          # not readable from JavaScript
    SESSION_COOKIE_SAMESITE="Lax",         # mitigates CSRF / cross-site sends
    SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "false").lower() == "true",
    PERMANENT_SESSION_LIFETIME=60 * 60 * 8,  # 8 hours
    MAX_CONTENT_LENGTH=1 * 1024 * 1024,    # 1 MB request cap
    WTF_CSRF_TIME_LIMIT=None,              # CSRF token valid for the session
)

csrf = CSRFProtect(app)

# --------------------------------------------------------------------------
# Validation limits
# --------------------------------------------------------------------------
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,30}$")
PASSWORD_MIN = 8
PASSWORD_MAX = 128            # bcrypt only uses the first 72 bytes; cap input
TITLE_MAX = 200
BODY_MAX = 20000
COMMENT_NAME_MAX = 60
COMMENT_BODY_MAX = 2000


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db():
    """Return a per-request SQLite connection."""
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables if they do not already exist."""
    db = sqlite3.connect(app.config["DATABASE"])
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT    NOT NULL UNIQUE,
                password_hash TEXT    NOT NULL,
                created_at    TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS articles (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                author_id  INTEGER NOT NULL,
                title      TEXT    NOT NULL,
                body       TEXT    NOT NULL,
                created_at TEXT    NOT NULL,
                FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS comments (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                article_id  INTEGER NOT NULL,
                author_name TEXT    NOT NULL,
                body        TEXT    NOT NULL,
                created_at  TEXT    NOT NULL,
                FOREIGN KEY (article_id) REFERENCES articles(id) ON DELETE CASCADE
            );
            """
        )
        db.commit()
    finally:
        db.close()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


# --------------------------------------------------------------------------
# Authentication helpers
# --------------------------------------------------------------------------
def current_user():
    """Return the logged-in user row, or None."""
    uid = session.get("user_id")
    if uid is None:
        return None
    db = get_db()
    return db.execute(
        "SELECT id, username FROM users WHERE id = ?", (uid,)
    ).fetchone()


@app.context_processor
def inject_user():
    return {"current_user": current_user()}


def login_required(view):
    """Decorator that redirects anonymous users to the login page."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------
# Routes: articles
# --------------------------------------------------------------------------
@app.route("/")
def index():
    db = get_db()
    articles = db.execute(
        """
        SELECT a.id, a.title, a.created_at, u.username AS author
        FROM articles a
        JOIN users u ON u.id = a.author_id
        ORDER BY a.id DESC
        """
    ).fetchall()
    return render_template("index.html", articles=articles)


@app.route("/article/<int:article_id>")
def view_article(article_id):
    db = get_db()
    article = db.execute(
        """
        SELECT a.id, a.title, a.body, a.created_at, a.author_id, u.username AS author
        FROM articles a
        JOIN users u ON u.id = a.author_id
        WHERE a.id = ?
        """,
        (article_id,),
    ).fetchone()
    if article is None:
        abort(404)
    comments = db.execute(
        """
        SELECT author_name, body, created_at
        FROM comments
        WHERE article_id = ?
        ORDER BY id ASC
        """,
        (article_id,),
    ).fetchall()
    return render_template("article.html", article=article, comments=comments)


@app.route("/article/new", methods=["GET", "POST"])
@login_required
def new_article():
    if request.method == "POST":
        title = (request.form.get("title") or "").strip()
        body = (request.form.get("body") or "").strip()
        errors = _validate_article(title, body)
        if errors:
            for e in errors:
                flash(e, "error")
            return render_template("article_form.html", title=title, body=body, mode="new")

        db = get_db()
        cur = db.execute(
            "INSERT INTO articles (author_id, title, body, created_at) VALUES (?, ?, ?, ?)",
            (current_user()["id"], title, body, now_iso()),
        )
        db.commit()
        flash("Article published.", "success")
        return redirect(url_for("view_article", article_id=cur.lastrowid))

    return render_template("article_form.html", title="", body="", mode="new")


@app.route("/article/<int:article_id>/edit", methods=["GET", "POST"])
@login_required
def edit_article(article_id):
    db = get_db()
    article = db.execute(
        "SELECT id, author_id, title, body FROM articles WHERE id = ?",
        (article_id,),
    ).fetchone()
    if article is None:
        abort(404)
    # Access control: only the owning author may edit (prevents IDOR).
    if article["author_id"] != current_user()["id"]:
        abort(403)

    if request.method == "POST":
        title = (request.form.get("title") or "").strip()
        body = (request.form.get("body") or "").strip()
        errors = _validate_article(title, body)
        if errors:
            for e in errors:
                flash(e, "error")
            return render_template(
                "article_form.html", title=title, body=body, mode="edit",
                article_id=article_id,
            )
        db.execute(
            "UPDATE articles SET title = ?, body = ? WHERE id = ?",
            (title, body, article_id),
        )
        db.commit()
        flash("Article updated.", "success")
        return redirect(url_for("view_article", article_id=article_id))

    return render_template(
        "article_form.html", title=article["title"], body=article["body"],
        mode="edit", article_id=article_id,
    )


@app.route("/article/<int:article_id>/delete", methods=["POST"])
@login_required
def delete_article(article_id):
    db = get_db()
    article = db.execute(
        "SELECT id, author_id FROM articles WHERE id = ?", (article_id,)
    ).fetchone()
    if article is None:
        abort(404)
    if article["author_id"] != current_user()["id"]:
        abort(403)
    db.execute("DELETE FROM articles WHERE id = ?", (article_id,))
    db.commit()
    flash("Article deleted.", "success")
    return redirect(url_for("index"))


def _validate_article(title, body):
    errors = []
    if not title:
        errors.append("Title is required.")
    elif len(title) > TITLE_MAX:
        errors.append(f"Title must be at most {TITLE_MAX} characters.")
    if not body:
        errors.append("Body is required.")
    elif len(body) > BODY_MAX:
        errors.append(f"Body must be at most {BODY_MAX} characters.")
    return errors


# --------------------------------------------------------------------------
# Routes: comments
# --------------------------------------------------------------------------
@app.route("/article/<int:article_id>/comment", methods=["POST"])
def add_comment(article_id):
    db = get_db()
    article = db.execute(
        "SELECT id FROM articles WHERE id = ?", (article_id,)
    ).fetchone()
    if article is None:
        abort(404)

    name = (request.form.get("author_name") or "").strip()
    body = (request.form.get("body") or "").strip()

    # If logged in, attribute the comment to the account; otherwise require a name.
    user = current_user()
    if user is not None:
        name = user["username"]

    errors = []
    if not name:
        errors.append("Name is required.")
    elif len(name) > COMMENT_NAME_MAX:
        errors.append(f"Name must be at most {COMMENT_NAME_MAX} characters.")
    if not body:
        errors.append("Comment cannot be empty.")
    elif len(body) > COMMENT_BODY_MAX:
        errors.append(f"Comment must be at most {COMMENT_BODY_MAX} characters.")

    if errors:
        for e in errors:
            flash(e, "error")
    else:
        db.execute(
            "INSERT INTO comments (article_id, author_name, body, created_at) "
            "VALUES (?, ?, ?, ?)",
            (article_id, name, body, now_iso()),
        )
        db.commit()
        flash("Comment posted.", "success")

    return redirect(url_for("view_article", article_id=article_id) + "#comments")


# --------------------------------------------------------------------------
# Routes: authentication
# --------------------------------------------------------------------------
@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user() is not None:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        errors = []
        if not USERNAME_RE.match(username):
            errors.append(
                "Username must be 3-30 characters: letters, digits or underscore."
            )
        if not (PASSWORD_MIN <= len(password) <= PASSWORD_MAX):
            errors.append(
                f"Password must be between {PASSWORD_MIN} and {PASSWORD_MAX} characters."
            )

        if not errors:
            password_hash = bcrypt.hashpw(
                password.encode("utf-8"), bcrypt.gensalt()
            ).decode("utf-8")
            db = get_db()
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash, created_at) "
                    "VALUES (?, ?, ?)",
                    (username, password_hash, now_iso()),
                )
                db.commit()
            except sqlite3.IntegrityError:
                # Unique constraint -> username taken. Generic message.
                errors.append("That username is not available.")
            else:
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))

        for e in errors:
            flash(e, "error")
        return render_template("register.html", username=username)

    return render_template("register.html", username="")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user() is not None:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = (request.form.get("username") or "").strip()
        password = request.form.get("password") or ""

        db = get_db()
        user = db.execute(
            "SELECT id, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        # Constant-ish: always run bcrypt to reduce username enumeration timing.
        stored = user["password_hash"].encode("utf-8") if user else _DUMMY_HASH
        valid = bcrypt.checkpw(password.encode("utf-8"), stored)

        if user and valid:
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            flash("Logged in.", "success")
            return redirect(_safe_next(request.args.get("next")))

        # Same message whether the user exists or not.
        flash("Invalid username or password.", "error")
        return render_template("login.html", username=username)

    return render_template("login.html", username="")


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("Logged out.", "success")
    return redirect(url_for("index"))


# Precomputed bcrypt hash of a random value, used for timing equalisation.
_DUMMY_HASH = bcrypt.hashpw(os.urandom(16).hex().encode("utf-8"), bcrypt.gensalt())


def _safe_next(target):
    """Only allow relative redirects to avoid open-redirect abuse."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return url_for("index")


# --------------------------------------------------------------------------
# Security headers
# --------------------------------------------------------------------------
@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self'; "
        "script-src 'self'; frame-ancestors 'none'; base-uri 'self'; "
        "form-action 'self'"
    )
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    return response


# --------------------------------------------------------------------------
# Error handlers (no internal details leak to the client)
# --------------------------------------------------------------------------
@app.errorhandler(400)
def bad_request(e):
    return render_template("error.html", code=400, message="Bad request."), 400


@app.errorhandler(403)
def forbidden(e):
    return render_template("error.html", code=403,
                           message="You do not have permission to do that."), 403


@app.errorhandler(404)
def not_found(e):
    return render_template("error.html", code=404, message="Page not found."), 404


@app.errorhandler(CSRFError)
def handle_csrf_error(e):
    return render_template("error.html", code=400,
                           message="The form session expired. Please try again."), 400


@app.errorhandler(500)
def server_error(e):
    # The real exception is logged by Flask; the client sees only this.
    return render_template("error.html", code=500,
                           message="Something went wrong on our end."), 500


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------
init_db()

if __name__ == "__main__":
    # debug must stay False so tracebacks are never exposed to clients.
    app.run(host="127.0.0.1", port=5042, debug=False)
