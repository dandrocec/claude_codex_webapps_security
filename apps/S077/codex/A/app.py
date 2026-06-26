import os
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from flask import Flask, abort, flash, g, redirect, render_template, request, session, url_for


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "wiki.sqlite3")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def slugify(value):
    slug = "".join(ch.lower() if ch.isalnum() else "-" for ch in value.strip())
    slug = "-".join(part for part in slug.split("-") if part)
    return slug[:80] or "untitled"


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS pages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL,
            editor_only INTEGER NOT NULL DEFAULT 0,
            current_revision_id INTEGER,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (current_revision_id) REFERENCES revisions(id)
        );

        CREATE TABLE IF NOT EXISTS revisions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            page_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            editor_only INTEGER NOT NULL DEFAULT 0,
            author TEXT NOT NULL,
            note TEXT,
            created_at TEXT NOT NULL,
            restored_from_revision_id INTEGER,
            FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE,
            FOREIGN KEY (restored_from_revision_id) REFERENCES revisions(id)
        );
        """
    )
    db.commit()


@app.before_request
def ensure_database():
    init_db()


def current_user():
    return {
        "name": session.get("name", "Guest"),
        "role": session.get("role", "viewer"),
    }


def is_editor():
    return current_user()["role"] == "editor"


@app.context_processor
def inject_user():
    return {"current_user": current_user(), "is_editor": is_editor()}


def editor_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if not is_editor():
            flash("Editors only.", "error")
            return redirect(url_for("index"))
        return view(*args, **kwargs)

    return wrapped


def get_page(slug):
    page = get_db().execute("SELECT * FROM pages WHERE slug = ?", (slug,)).fetchone()
    if page is None:
        abort(404)
    if page["editor_only"] and not is_editor():
        abort(403)
    return page


def get_current_revision(page_id):
    return get_db().execute(
        """
        SELECT revisions.*
        FROM revisions
        JOIN pages ON pages.current_revision_id = revisions.id
        WHERE pages.id = ?
        """,
        (page_id,),
    ).fetchone()


def create_revision(page_id, title, body, editor_only, author, note="", restored_from=None):
    db = get_db()
    created_at = now_iso()
    cursor = db.execute(
        """
        INSERT INTO revisions
            (page_id, title, body, editor_only, author, note, created_at, restored_from_revision_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (page_id, title, body, int(editor_only), author, note, created_at, restored_from),
    )
    revision_id = cursor.lastrowid
    db.execute(
        """
        UPDATE pages
        SET title = ?, editor_only = ?, current_revision_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (title, int(editor_only), revision_id, created_at, page_id),
    )
    db.commit()
    return revision_id


@app.route("/")
def index():
    if is_editor():
        pages = get_db().execute("SELECT * FROM pages ORDER BY updated_at DESC").fetchall()
    else:
        pages = get_db().execute(
            "SELECT * FROM pages WHERE editor_only = 0 ORDER BY updated_at DESC"
        ).fetchall()
    return render_template("index.html", pages=pages)


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        name = request.form.get("name", "").strip() or "Guest"
        role = request.form.get("role", "viewer")
        if role not in {"viewer", "editor"}:
            role = "viewer"
        session["name"] = name[:60]
        session["role"] = role
        flash(f"Signed in as {session['name']} ({role}).", "success")
        return redirect(url_for("index"))
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Signed out.", "success")
    return redirect(url_for("index"))


@app.route("/pages/new", methods=["GET", "POST"])
@editor_required
def new_page():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()
        editor_only = "editor_only" in request.form
        note = request.form.get("note", "").strip()

        if not title:
            flash("Title is required.", "error")
            return render_template("edit.html", page=None, revision=None)

        db = get_db()
        base_slug = slugify(title)
        slug = base_slug
        suffix = 2
        while db.execute("SELECT 1 FROM pages WHERE slug = ?", (slug,)).fetchone():
            slug = f"{base_slug}-{suffix}"
            suffix += 1

        created_at = now_iso()
        cursor = db.execute(
            """
            INSERT INTO pages (slug, title, editor_only, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (slug, title, int(editor_only), created_at, created_at),
        )
        page_id = cursor.lastrowid
        db.commit()
        create_revision(page_id, title, body, editor_only, current_user()["name"], note)
        flash("Page created.", "success")
        return redirect(url_for("view_page", slug=slug))

    return render_template("edit.html", page=None, revision=None)


@app.route("/pages/<slug>")
def view_page(slug):
    page = get_page(slug)
    revision = get_current_revision(page["id"])
    return render_template("page.html", page=page, revision=revision)


@app.route("/pages/<slug>/edit", methods=["GET", "POST"])
@editor_required
def edit_page(slug):
    page = get_page(slug)
    revision = get_current_revision(page["id"])

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()
        editor_only = "editor_only" in request.form
        note = request.form.get("note", "").strip()

        if not title:
            flash("Title is required.", "error")
            return render_template("edit.html", page=page, revision=revision)

        create_revision(page["id"], title, body, editor_only, current_user()["name"], note)
        flash("Revision saved.", "success")
        return redirect(url_for("view_page", slug=slug))

    return render_template("edit.html", page=page, revision=revision)


@app.route("/pages/<slug>/history")
def history(slug):
    page = get_page(slug)
    revisions = get_db().execute(
        "SELECT * FROM revisions WHERE page_id = ? ORDER BY id DESC", (page["id"],)
    ).fetchall()
    return render_template("history.html", page=page, revisions=revisions)


@app.route("/pages/<slug>/revisions/<int:revision_id>")
def view_revision(slug, revision_id):
    page = get_page(slug)
    revision = get_db().execute(
        "SELECT * FROM revisions WHERE page_id = ? AND id = ?", (page["id"], revision_id)
    ).fetchone()
    if revision is None:
        abort(404)
    if revision["editor_only"] and not is_editor():
        abort(403)
    return render_template("revision.html", page=page, revision=revision)


@app.route("/pages/<slug>/revisions/<int:revision_id>/restore", methods=["POST"])
@editor_required
def restore_revision(slug, revision_id):
    page = get_page(slug)
    revision = get_db().execute(
        "SELECT * FROM revisions WHERE page_id = ? AND id = ?", (page["id"], revision_id)
    ).fetchone()
    if revision is None:
        abort(404)

    new_revision_id = create_revision(
        page["id"],
        revision["title"],
        revision["body"],
        revision["editor_only"],
        current_user()["name"],
        f"Restored revision #{revision_id}",
        restored_from=revision_id,
    )
    flash(f"Restored revision #{revision_id} as revision #{new_revision_id}.", "success")
    return redirect(url_for("view_page", slug=slug))


@app.errorhandler(403)
def forbidden(error):
    return render_template("error.html", title="Forbidden", message="You cannot view this page."), 403


@app.errorhandler(404)
def not_found(error):
    return render_template("error.html", title="Not found", message="That page does not exist."), 404


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5077, debug=True)
