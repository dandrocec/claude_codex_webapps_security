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


DATABASE = os.environ.get("WIKI_DB", os.path.join(os.path.dirname(__file__), "wiki.sqlite3"))
TITLE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$")
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]{3,40}$")


def utcnow():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_urlsafe(64),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=512 * 1024,
    )

    @app.before_request
    def load_user_and_protect_csrf():
        g.user = None
        user_id = session.get("user_id")
        if user_id:
            g.user = query_one("SELECT id, username, role FROM users WHERE id = ?", (user_id,))
            if g.user is None:
                session.clear()

        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            token = session.get("csrf_token")
            submitted = request.form.get("csrf_token") or request.headers.get("X-CSRF-Token")
            if not token or not submitted or not secrets.compare_digest(token, submitted):
                abort(400)

    @app.after_request
    def add_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.teardown_appcontext
    def close_db(_error):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.context_processor
    def inject_helpers():
        return {"csrf_token": csrf_token, "current_user": lambda: g.user}

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", message="The request could not be processed."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", message="You do not have access to that resource."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", message="That page was not found."), 404

    @app.errorhandler(500)
    def server_error(_error):
        return render_template("error.html", message="An internal error occurred."), 500

    @app.route("/")
    @login_required
    def index():
        if is_editor():
            pages = query_all(
                """
                SELECT p.*, u.username AS updated_by_name
                FROM pages p LEFT JOIN users u ON u.id = p.updated_by
                ORDER BY p.updated_at DESC
                """
            )
        else:
            pages = query_all(
                """
                SELECT p.*, u.username AS updated_by_name
                FROM pages p LEFT JOIN users u ON u.id = p.updated_by
                WHERE p.editor_only = 0
                ORDER BY p.updated_at DESC
                """
            )
        return render_template("index.html", pages=pages)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = clean_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            if not username:
                flash("Use 3-40 letters, numbers, dots, underscores, or hyphens for the username.")
                return render_template("register.html"), 400
            if not valid_password(password):
                flash("Password must be at least 12 characters.")
                return render_template("register.html"), 400

            role = "editor" if user_count() == 0 else "viewer"
            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            try:
                execute(
                    "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
                    (username, password_hash, role, utcnow()),
                )
            except sqlite3.IntegrityError:
                flash("That username is already taken.")
                return render_template("register.html"), 400
            flash("Account created. Sign in to continue.")
            return redirect(url_for("login"))
        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = clean_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = query_one("SELECT id, username, password_hash, role FROM users WHERE username = ?", (username,))
            if not user or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
                flash("Invalid username or password.")
                return render_template("login.html"), 400
            session.clear()
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("index"))
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/pages/new", methods=["GET", "POST"])
    @editor_required
    def new_page():
        if request.method == "POST":
            title, content, editor_only, summary = parse_page_form()
            if not title:
                return render_template("page_form.html", page=None), 400
            slug = slugify(title)
            now = utcnow()
            try:
                page_id = execute(
                    """
                    INSERT INTO pages
                    (slug, title, content, editor_only, created_by, updated_by, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (slug, title, content, editor_only, g.user["id"], g.user["id"], now, now),
                ).lastrowid
            except sqlite3.IntegrityError:
                flash("A page with that title already exists.")
                return render_template("page_form.html", page=None), 400
            save_revision(page_id, 1, title, content, editor_only, g.user["id"], summary or "Created page", now)
            return redirect(url_for("view_page", slug=slug))
        return render_template("page_form.html", page=None)

    @app.route("/pages/<slug>")
    @login_required
    def view_page(slug):
        page = get_visible_page_or_404(slug)
        return render_template("page_view.html", page=page)

    @app.route("/pages/<slug>/edit", methods=["GET", "POST"])
    @editor_required
    def edit_page(slug):
        page = get_page_or_404(slug)
        if request.method == "POST":
            title, content, editor_only, summary = parse_page_form()
            if not title:
                return render_template("page_form.html", page=page), 400
            new_slug = slugify(title)
            now = utcnow()
            revision_number = next_revision_number(page["id"])
            try:
                execute(
                    """
                    UPDATE pages
                    SET slug = ?, title = ?, content = ?, editor_only = ?, updated_by = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (new_slug, title, content, editor_only, g.user["id"], now, page["id"]),
                )
            except sqlite3.IntegrityError:
                flash("A page with that title already exists.")
                return render_template("page_form.html", page=page), 400
            save_revision(page["id"], revision_number, title, content, editor_only, g.user["id"], summary, now)
            return redirect(url_for("view_page", slug=new_slug))
        return render_template("page_form.html", page=page)

    @app.route("/pages/<slug>/history")
    @login_required
    def history(slug):
        page = get_visible_page_or_404(slug)
        revisions = query_all(
            """
            SELECT r.*, u.username AS edited_by_name
            FROM revisions r JOIN users u ON u.id = r.edited_by
            WHERE r.page_id = ?
            ORDER BY r.revision_number DESC
            """,
            (page["id"],),
        )
        return render_template("history.html", page=page, revisions=revisions)

    @app.route("/pages/<slug>/revisions/<int:revision_id>")
    @login_required
    def revision(slug, revision_id):
        page = get_visible_page_or_404(slug)
        rev = query_one(
            """
            SELECT r.*, u.username AS edited_by_name
            FROM revisions r JOIN users u ON u.id = r.edited_by
            WHERE r.id = ? AND r.page_id = ?
            """,
            (revision_id, page["id"]),
        )
        if rev is None:
            abort(404)
        return render_template("revision.html", page=page, revision=rev)

    @app.route("/pages/<slug>/revisions/<int:revision_id>/restore", methods=["POST"])
    @editor_required
    def restore_revision(slug, revision_id):
        page = get_page_or_404(slug)
        rev = query_one("SELECT * FROM revisions WHERE id = ? AND page_id = ?", (revision_id, page["id"]))
        if rev is None:
            abort(404)
        now = utcnow()
        revision_number = next_revision_number(page["id"])
        restored_slug = slugify(rev["title"])
        try:
            execute(
                """
                UPDATE pages
                SET slug = ?, title = ?, content = ?, editor_only = ?, updated_by = ?, updated_at = ?
                WHERE id = ?
                """,
                (restored_slug, rev["title"], rev["content"], rev["editor_only"], g.user["id"], now, page["id"]),
            )
        except sqlite3.IntegrityError:
            flash("That revision cannot be restored because another page now uses its title.")
            return redirect(url_for("revision", slug=page["slug"], revision_id=revision_id)), 400
        save_revision(
            page["id"],
            revision_number,
            rev["title"],
            rev["content"],
            rev["editor_only"],
            g.user["id"],
            f"Restored revision {rev['revision_number']}",
            now,
        )
        flash("Revision restored.")
        return redirect(url_for("view_page", slug=restored_slug))

    with app.app_context():
        init_db()

    return app


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
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            editor_only INTEGER NOT NULL DEFAULT 0 CHECK (editor_only IN (0, 1)),
            created_by INTEGER NOT NULL REFERENCES users(id),
            updated_by INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
            revision_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            editor_only INTEGER NOT NULL CHECK (editor_only IN (0, 1)),
            edited_by INTEGER NOT NULL REFERENCES users(id),
            edited_at TEXT NOT NULL,
            summary TEXT NOT NULL DEFAULT '',
            UNIQUE(page_id, revision_number)
        );

        CREATE INDEX IF NOT EXISTS idx_revisions_page ON revisions(page_id, revision_number);
        """
    )
    db.commit()


def execute(sql, params=()):
    cursor = get_db().execute(sql, params)
    get_db().commit()
    return cursor


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def csrf_token():
    if "csrf_token" not in session:
        session["csrf_token"] = secrets.token_urlsafe(32)
    return session["csrf_token"]


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


def editor_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        if g.user["role"] != "editor":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def is_editor():
    return g.user is not None and g.user["role"] == "editor"


def user_count():
    return query_one("SELECT COUNT(*) AS count FROM users")["count"]


def clean_username(value):
    value = (value or "").strip()
    return value if USERNAME_RE.fullmatch(value) else ""


def valid_password(value):
    return isinstance(value, str) and 12 <= len(value) <= 256


def clean_text(value, max_len):
    value = (value or "").replace("\x00", "").strip()
    if len(value) > max_len:
        value = value[:max_len]
    return value


def slugify(title):
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    return slug or "page"


def parse_page_form():
    title = clean_text(request.form.get("title"), 80)
    if not TITLE_RE.fullmatch(title):
        flash("Title must be 1-80 characters and contain only letters, numbers, spaces, dots, underscores, or hyphens.")
        return "", "", 0, ""
    content = clean_text(request.form.get("content"), 100000)
    summary = clean_text(request.form.get("summary"), 200)
    editor_only = 1 if request.form.get("editor_only") == "on" else 0
    return title, content, editor_only, summary


def get_page_or_404(slug):
    page = query_one(
        """
        SELECT p.*, cu.username AS created_by_name, uu.username AS updated_by_name
        FROM pages p
        JOIN users cu ON cu.id = p.created_by
        JOIN users uu ON uu.id = p.updated_by
        WHERE p.slug = ?
        """,
        (slug,),
    )
    if page is None:
        abort(404)
    return page


def get_visible_page_or_404(slug):
    page = get_page_or_404(slug)
    if page["editor_only"] and not is_editor():
        abort(403)
    return page


def next_revision_number(page_id):
    row = query_one("SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_number FROM revisions WHERE page_id = ?", (page_id,))
    return row["next_number"]


def save_revision(page_id, number, title, content, editor_only, edited_by, summary, edited_at):
    execute(
        """
        INSERT INTO revisions
        (page_id, revision_number, title, content, editor_only, edited_by, edited_at, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (page_id, number, title, content, editor_only, edited_by, edited_at, summary or ""),
    )


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5077)
