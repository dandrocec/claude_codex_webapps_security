import os
import re
import sqlite3
from functools import wraps
from pathlib import Path

import bleach
import markdown
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
from werkzeug.exceptions import HTTPException


BASE_DIR = Path(__file__).resolve().parent
DATABASE = Path(os.environ.get("DATABASE_URL", BASE_DIR / "wiki.sqlite3"))
TITLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 .,'!?():;_-]{2,119}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_@.-]{3,64}$")

ALLOWED_TAGS = set(bleach.sanitizer.ALLOWED_TAGS).union(
    {
        "p",
        "pre",
        "code",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "br",
        "hr",
        "img",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
    }
)
ALLOWED_ATTRIBUTES = {
    **bleach.sanitizer.ALLOWED_ATTRIBUTES,
    "a": ["href", "title", "rel"],
    "img": ["src", "alt", "title"],
}
ALLOWED_PROTOCOLS = {"http", "https", "mailto"}


def create_app():
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=secret_key,
        WTF_CSRF_TIME_LIMIT=3600,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=True,
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=512 * 1024,
    )

    bcrypt = Bcrypt(app)
    CSRFProtect(app)

    def get_db():
        if "db" not in g:
            g.db = sqlite3.connect(DATABASE)
            g.db.row_factory = sqlite3.Row
            g.db.execute("PRAGMA foreign_keys = ON")
        return g.db

    def init_db():
        DATABASE.parent.mkdir(parents=True, exist_ok=True)
        db = get_db()
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS pages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_id INTEGER NOT NULL,
                title TEXT NOT NULL UNIQUE,
                body TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_pages_title ON pages(title);
            CREATE INDEX IF NOT EXISTS idx_pages_owner ON pages(owner_id);
            """
        )
        db.commit()

    @app.before_request
    def load_user():
        init_db()
        g.user = None
        user_id = session.get("user_id")
        if user_id:
            g.user = get_db().execute(
                "SELECT id, username FROM users WHERE id = ?", (user_id,)
            ).fetchone()
            if g.user is None:
                session.clear()

    @app.teardown_appcontext
    def close_db(_error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' https: data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        return response

    def login_required(view):
        @wraps(view)
        def wrapped_view(*args, **kwargs):
            if g.user is None:
                flash("Please log in first.", "warning")
                return redirect(url_for("login", next=request.path))
            return view(*args, **kwargs)

        return wrapped_view

    def validate_title(title):
        title = " ".join((title or "").strip().split())
        if not TITLE_RE.fullmatch(title):
            return None, "Title must be 3-120 characters and start with a letter or number."
        return title, None

    def validate_body(body):
        body = (body or "").strip()
        if not body:
            return None, "Body is required."
        if len(body) > 100_000:
            return None, "Body must be 100,000 characters or fewer."
        return body, None

    def render_markdown(body):
        html = markdown.markdown(
            body,
            extensions=["fenced_code", "tables", "sane_lists"],
            output_format="html",
        )
        return bleach.clean(
            html,
            tags=ALLOWED_TAGS,
            attributes=ALLOWED_ATTRIBUTES,
            protocols=ALLOWED_PROTOCOLS,
            strip=True,
        )

    @app.route("/")
    def index():
        q = " ".join(request.args.get("q", "").strip().split())
        db = get_db()
        if q:
            pages = db.execute(
                """
                SELECT pages.id, pages.title, pages.updated_at, users.username AS owner
                FROM pages
                JOIN users ON users.id = pages.owner_id
                WHERE pages.title LIKE ?
                ORDER BY pages.updated_at DESC
                LIMIT 100
                """,
                (f"%{q}%",),
            ).fetchall()
        else:
            pages = db.execute(
                """
                SELECT pages.id, pages.title, pages.updated_at, users.username AS owner
                FROM pages
                JOIN users ON users.id = pages.owner_id
                ORDER BY pages.updated_at DESC
                LIMIT 100
                """
            ).fetchall()
        return render_template("index.html", pages=pages, q=q)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = (request.form.get("username") or "").strip().lower()
            password = request.form.get("password") or ""
            if not USERNAME_RE.fullmatch(username):
                flash("Username must be 3-64 characters.", "error")
            elif len(password) < 12 or len(password) > 128:
                flash("Password must be 12-128 characters.", "error")
            else:
                password_hash = bcrypt.generate_password_hash(password).decode("utf-8")
                try:
                    get_db().execute(
                        "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                        (username, password_hash),
                    )
                    get_db().commit()
                    flash("Account created. Please log in.", "success")
                    return redirect(url_for("login"))
                except sqlite3.IntegrityError:
                    flash("That username is already registered.", "error")
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = (request.form.get("username") or "").strip().lower()
            password = request.form.get("password") or ""
            user = get_db().execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()
            if user and bcrypt.check_password_hash(user["password_hash"], password):
                session.clear()
                session["user_id"] = user["id"]
                next_url = request.args.get("next")
                if not next_url or not next_url.startswith("/"):
                    next_url = url_for("index")
                return redirect(next_url)
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    @app.route("/pages/new", methods=["GET", "POST"])
    @login_required
    def create_page():
        if request.method == "POST":
            title, title_error = validate_title(request.form.get("title"))
            body, body_error = validate_body(request.form.get("body"))
            if title_error or body_error:
                flash(title_error or body_error, "error")
            else:
                try:
                    get_db().execute(
                        "INSERT INTO pages (owner_id, title, body) VALUES (?, ?, ?)",
                        (g.user["id"], title, body),
                    )
                    get_db().commit()
                    flash("Page created.", "success")
                    page = get_db().execute(
                        "SELECT id FROM pages WHERE title = ?", (title,)
                    ).fetchone()
                    return redirect(url_for("show_page", page_id=page["id"]))
                except sqlite3.IntegrityError:
                    flash("A page with that title already exists.", "error")
        return render_template("page_form.html", page=None)

    @app.route("/pages/<int:page_id>")
    def show_page(page_id):
        page = get_db().execute(
            """
            SELECT pages.id, pages.owner_id, pages.title, pages.body, pages.updated_at,
                   users.username AS owner
            FROM pages
            JOIN users ON users.id = pages.owner_id
            WHERE pages.id = ?
            """,
            (page_id,),
        ).fetchone()
        if page is None:
            abort(404)
        html_body = render_markdown(page["body"])
        return render_template("page.html", page=page, html_body=html_body)

    @app.route("/pages/<int:page_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_page(page_id):
        page = get_db().execute(
            "SELECT id, owner_id, title, body FROM pages WHERE id = ?", (page_id,)
        ).fetchone()
        if page is None:
            abort(404)
        if page["owner_id"] != g.user["id"]:
            abort(403)

        if request.method == "POST":
            title, title_error = validate_title(request.form.get("title"))
            body, body_error = validate_body(request.form.get("body"))
            if title_error or body_error:
                flash(title_error or body_error, "error")
            else:
                try:
                    get_db().execute(
                        """
                        UPDATE pages
                        SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ? AND owner_id = ?
                        """,
                        (title, body, page_id, g.user["id"]),
                    )
                    get_db().commit()
                    flash("Page updated.", "success")
                    return redirect(url_for("show_page", page_id=page_id))
                except sqlite3.IntegrityError:
                    flash("A page with that title already exists.", "error")
        return render_template("page_form.html", page=page)

    @app.errorhandler(Exception)
    def handle_error(error):
        if isinstance(error, HTTPException):
            code = error.code
            title = error.name
        else:
            code = 500
            title = "Internal Server Error"
            app.logger.exception("Unhandled application error")
        return render_template("error.html", code=code, title=title), code

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5036"))
    app.run(host="127.0.0.1", port=port, debug=False)
