import os
import re
import sqlite3
from functools import wraps

import markdown as md
import bleach
from flask import (
    Flask, g, render_template, request, redirect, url_for,
    session, flash, abort,
)
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "wiki.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = DATABASE

# Tags/attributes allowed in rendered Markdown output.
ALLOWED_TAGS = list(bleach.sanitizer.ALLOWED_TAGS) + [
    "p", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
    "img", "hr", "br", "table", "thead", "tbody", "tr", "th", "td",
    "span", "del",
]
ALLOWED_ATTRS = {
    **bleach.sanitizer.ALLOWED_ATTRIBUTES,
    "img": ["src", "alt", "title"],
    "a": ["href", "title"],
    "td": ["align"],
    "th": ["align"],
}


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(app.config["DATABASE"])
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pages (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT UNIQUE NOT NULL,
            body       TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            author_id  INTEGER,
            FOREIGN KEY (author_id) REFERENCES users(id)
        );
        """
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
    return get_db().execute("SELECT * FROM users WHERE id = ?", (uid,)).fetchone()


@app.context_processor
def inject_user():
    return {"current_user": current_user()}


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if session.get("user_id") is None:
            flash("Please log in to edit pages.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)
    return wrapped


# --------------------------------------------------------------------------- #
# Markdown rendering
# --------------------------------------------------------------------------- #
def render_markdown(text):
    html = md.markdown(
        text or "",
        extensions=["fenced_code", "tables", "nl2br", "sane_lists"],
    )
    return bleach.clean(html, tags=ALLOWED_TAGS, attributes=ALLOWED_ATTRS)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    pages = get_db().execute(
        "SELECT title, updated_at FROM pages ORDER BY title COLLATE NOCASE"
    ).fetchall()
    return render_template("index.html", pages=pages)


@app.route("/search")
def search():
    q = request.args.get("q", "").strip()
    results = []
    if q:
        results = get_db().execute(
            "SELECT title, updated_at FROM pages "
            "WHERE title LIKE ? ORDER BY title COLLATE NOCASE",
            (f"%{q}%",),
        ).fetchall()
    return render_template("search.html", q=q, results=results)


@app.route("/wiki/<title>")
def view_page(title):
    page = get_db().execute(
        "SELECT * FROM pages WHERE title = ?", (title,)
    ).fetchone()
    if page is None:
        return render_template("missing.html", title=title), 404
    return render_template(
        "page.html", page=page, body_html=render_markdown(page["body"])
    )


@app.route("/wiki/<title>/edit", methods=["GET", "POST"])
@login_required
def edit_page(title):
    db = get_db()
    page = db.execute("SELECT * FROM pages WHERE title = ?", (title,)).fetchone()

    if request.method == "POST":
        new_title = request.form.get("title", "").strip()
        body = request.form.get("body", "")
        if not new_title:
            flash("Title is required.", "error")
            return render_template("edit.html", title=title, body=body, page=page)

        # Guard against colliding with a *different* existing page.
        clash = db.execute(
            "SELECT id FROM pages WHERE title = ? AND title <> ?",
            (new_title, title),
        ).fetchone()
        if clash:
            flash(f"A page titled “{new_title}” already exists.", "error")
            return render_template("edit.html", title=title, body=body, page=page)

        if page is None:
            db.execute(
                "INSERT INTO pages (title, body, author_id) VALUES (?, ?, ?)",
                (new_title, body, session["user_id"]),
            )
        else:
            db.execute(
                "UPDATE pages SET title = ?, body = ?, "
                "updated_at = datetime('now'), author_id = ? WHERE id = ?",
                (new_title, body, session["user_id"], page["id"]),
            )
        db.commit()
        return redirect(url_for("view_page", title=new_title))

    body = page["body"] if page else ""
    return render_template("edit.html", title=title, body=body, page=page)


@app.route("/new", methods=["GET", "POST"])
@login_required
def new_page():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        if not title:
            flash("Title is required.", "error")
            return render_template("new.html")
        existing = get_db().execute(
            "SELECT id FROM pages WHERE title = ?", (title,)
        ).fetchone()
        if existing:
            return redirect(url_for("edit_page", title=title))
        # Hand off to the editor pre-filled with the title.
        return redirect(url_for("edit_page", title=title))
    return render_template("new.html")


# --------------------------------------------------------------------------- #
# Authentication routes
# --------------------------------------------------------------------------- #
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Username and password are required.", "error")
            return render_template("register.html")
        db = get_db()
        try:
            db.execute(
                "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                (username, generate_password_hash(password)),
            )
            db.commit()
        except sqlite3.IntegrityError:
            flash("That username is already taken.", "error")
            return render_template("register.html")
        user = db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        session["user_id"] = user["id"]
        flash(f"Welcome, {username}!", "success")
        return redirect(url_for("index"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()
        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            flash(f"Welcome back, {username}!", "success")
            nxt = request.args.get("next") or url_for("index")
            return redirect(nxt)
        flash("Invalid username or password.", "error")
    return render_template("login.html")


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


# Make the rendered title link helper available in templates.
@app.template_filter("wikilink")
def wikilink(title):
    return url_for("view_page", title=title)


with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5036, debug=True)
