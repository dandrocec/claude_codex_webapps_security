"""A small Flask wiki with page history.

Roles:
  - viewer: can read pages (except editor-only ones)
  - editor: can create, edit, restore revisions, and read every page

Every edit creates a new revision. Old revisions can be viewed and restored.
"""
import os
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask, g, redirect, render_template, request, session, url_for, abort, flash
)
from werkzeug.security import check_password_hash, generate_password_hash

DATABASE = os.path.join(os.path.dirname(__file__), "wiki.db")


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables and seed two demo users if the database is empty."""
    db = sqlite3.connect(DATABASE)
    db.row_factory = sqlite3.Row
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role          TEXT NOT NULL CHECK (role IN ('viewer', 'editor'))
        );

        CREATE TABLE IF NOT EXISTS pages (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            slug        TEXT UNIQUE NOT NULL,
            editor_only INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS revisions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id    INTEGER NOT NULL,
            title      TEXT NOT NULL,
            content    TEXT NOT NULL,
            author_id  INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (page_id) REFERENCES pages (id) ON DELETE CASCADE,
            FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE SET NULL
        );
        """
    )

    seeded = db.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    if seeded == 0:
        db.executemany(
            "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
            [
                ("editor", generate_password_hash("editor"), "editor"),
                ("viewer", generate_password_hash("viewer"), "viewer"),
            ],
        )
    db.commit()
    db.close()


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def current_user():
    uid = session.get("user_id")
    if uid is None:
        return None
    return get_db().execute(
        "SELECT id, username, role FROM users WHERE id = ?", (uid,)
    ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_user() is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


def editor_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        user = current_user()
        if user is None:
            return redirect(url_for("login", next=request.path))
        if user["role"] != "editor":
            abort(403)
        return view(*args, **kwargs)
    return wrapped


def utcnow():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


# --------------------------------------------------------------------------- #
# Application factory
# --------------------------------------------------------------------------- #
def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
    app.teardown_appcontext(close_db)

    @app.context_processor
    def inject_user():
        return {"user": current_user()}

    # ----- auth ----------------------------------------------------------- #
    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            row = get_db().execute(
                "SELECT * FROM users WHERE username = ?", (username,)
            ).fetchone()
            if row and check_password_hash(row["password_hash"], password):
                session.clear()
                session["user_id"] = row["id"]
                return redirect(request.args.get("next") or url_for("index"))
            flash("Invalid username or password.", "error")
        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        return redirect(url_for("index"))

    # ----- page list ------------------------------------------------------ #
    @app.route("/")
    def index():
        user = current_user()
        db = get_db()
        rows = db.execute(
            """
            SELECT p.slug, p.editor_only, r.title, r.created_at
            FROM pages p
            JOIN revisions r ON r.id = (
                SELECT id FROM revisions WHERE page_id = p.id
                ORDER BY id DESC LIMIT 1
            )
            ORDER BY r.created_at DESC
            """
        ).fetchall()
        if not (user and user["role"] == "editor"):
            rows = [r for r in rows if not r["editor_only"]]
        return render_template("index.html", pages=rows)

    # ----- view a page ---------------------------------------------------- #
    @app.route("/wiki/<slug>")
    def view_page(slug):
        db = get_db()
        page = db.execute("SELECT * FROM pages WHERE slug = ?", (slug,)).fetchone()
        if page is None:
            return render_template("missing.html", slug=slug), 404
        user = current_user()
        if page["editor_only"] and not (user and user["role"] == "editor"):
            abort(403)
        rev = db.execute(
            "SELECT * FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 1",
            (page["id"],),
        ).fetchone()
        return render_template("page.html", page=page, rev=rev)

    # ----- create a page -------------------------------------------------- #
    @app.route("/create", methods=["GET", "POST"])
    @editor_required
    def create_page():
        db = get_db()
        if request.method == "POST":
            slug = request.form.get("slug", "").strip().lower().replace(" ", "-")
            title = request.form.get("title", "").strip()
            content = request.form.get("content", "")
            editor_only = 1 if request.form.get("editor_only") else 0

            if not slug or not title:
                flash("Slug and title are required.", "error")
                return render_template("edit.html", page=None, rev=None, form=request.form)
            if db.execute("SELECT 1 FROM pages WHERE slug = ?", (slug,)).fetchone():
                flash("A page with that slug already exists.", "error")
                return render_template("edit.html", page=None, rev=None, form=request.form)

            cur = db.execute(
                "INSERT INTO pages (slug, editor_only) VALUES (?, ?)", (slug, editor_only)
            )
            db.execute(
                "INSERT INTO revisions (page_id, title, content, author_id, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (cur.lastrowid, title, content, session["user_id"], utcnow()),
            )
            db.commit()
            return redirect(url_for("view_page", slug=slug))
        return render_template("edit.html", page=None, rev=None, form={})

    # ----- edit a page ---------------------------------------------------- #
    @app.route("/wiki/<slug>/edit", methods=["GET", "POST"])
    @editor_required
    def edit_page(slug):
        db = get_db()
        page = db.execute("SELECT * FROM pages WHERE slug = ?", (slug,)).fetchone()
        if page is None:
            abort(404)
        rev = db.execute(
            "SELECT * FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 1",
            (page["id"],),
        ).fetchone()

        if request.method == "POST":
            title = request.form.get("title", "").strip()
            content = request.form.get("content", "")
            editor_only = 1 if request.form.get("editor_only") else 0
            if not title:
                flash("Title is required.", "error")
                return render_template("edit.html", page=page, rev=rev, form=request.form)
            db.execute(
                "UPDATE pages SET editor_only = ? WHERE id = ?", (editor_only, page["id"])
            )
            db.execute(
                "INSERT INTO revisions (page_id, title, content, author_id, created_at)"
                " VALUES (?, ?, ?, ?, ?)",
                (page["id"], title, content, session["user_id"], utcnow()),
            )
            db.commit()
            return redirect(url_for("view_page", slug=slug))
        return render_template("edit.html", page=page, rev=rev, form={})

    # ----- revision history ----------------------------------------------- #
    @app.route("/wiki/<slug>/history")
    def history(slug):
        db = get_db()
        page = db.execute("SELECT * FROM pages WHERE slug = ?", (slug,)).fetchone()
        if page is None:
            abort(404)
        user = current_user()
        if page["editor_only"] and not (user and user["role"] == "editor"):
            abort(403)
        revs = db.execute(
            """
            SELECT r.*, u.username AS author
            FROM revisions r
            LEFT JOIN users u ON u.id = r.author_id
            WHERE r.page_id = ?
            ORDER BY r.id DESC
            """,
            (page["id"],),
        ).fetchall()
        current_id = revs[0]["id"] if revs else None
        return render_template("history.html", page=page, revs=revs, current_id=current_id)

    # ----- view one specific revision ------------------------------------- #
    @app.route("/wiki/<slug>/revision/<int:rev_id>")
    def view_revision(slug, rev_id):
        db = get_db()
        page = db.execute("SELECT * FROM pages WHERE slug = ?", (slug,)).fetchone()
        if page is None:
            abort(404)
        user = current_user()
        if page["editor_only"] and not (user and user["role"] == "editor"):
            abort(403)
        rev = db.execute(
            "SELECT r.*, u.username AS author FROM revisions r"
            " LEFT JOIN users u ON u.id = r.author_id"
            " WHERE r.id = ? AND r.page_id = ?",
            (rev_id, page["id"]),
        ).fetchone()
        if rev is None:
            abort(404)
        latest = db.execute(
            "SELECT id FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 1",
            (page["id"],),
        ).fetchone()
        is_current = latest and latest["id"] == rev_id
        return render_template(
            "revision.html", page=page, rev=rev, is_current=is_current
        )

    # ----- restore an old revision ---------------------------------------- #
    @app.route("/wiki/<slug>/restore/<int:rev_id>", methods=["POST"])
    @editor_required
    def restore_revision(slug, rev_id):
        db = get_db()
        page = db.execute("SELECT * FROM pages WHERE slug = ?", (slug,)).fetchone()
        if page is None:
            abort(404)
        old = db.execute(
            "SELECT * FROM revisions WHERE id = ? AND page_id = ?", (rev_id, page["id"])
        ).fetchone()
        if old is None:
            abort(404)
        # Restoring creates a *new* revision so history is never lost.
        db.execute(
            "INSERT INTO revisions (page_id, title, content, author_id, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (page["id"], old["title"], old["content"], session["user_id"], utcnow()),
        )
        db.commit()
        flash(f"Restored revision #{rev_id}.", "info")
        return redirect(url_for("view_page", slug=slug))

    return app


app = create_app()

if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5077, debug=True)
