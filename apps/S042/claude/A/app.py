"""A small Flask news site.

- Authors register/log in and publish articles.
- Visitors (no login required) read articles and post comments.
- Articles and comments are stored in SQLite.
"""

import os
import sqlite3
from datetime import datetime

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
from werkzeug.security import check_password_hash, generate_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "news.db")

app = Flask(__name__)
# In a real deployment set this via an environment variable.
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = DATABASE


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #
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
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS authors (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE,
            password_hash TEXT    NOT NULL,
            created_at    TEXT    NOT NULL
        );

        CREATE TABLE IF NOT EXISTS articles (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            title      TEXT    NOT NULL,
            body       TEXT    NOT NULL,
            author_id  INTEGER NOT NULL,
            created_at TEXT    NOT NULL,
            FOREIGN KEY (author_id) REFERENCES authors (id)
        );

        CREATE TABLE IF NOT EXISTS comments (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            author_name TEXT   NOT NULL,
            body       TEXT    NOT NULL,
            created_at TEXT    NOT NULL,
            FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


@app.cli.command("init-db")
def init_db_command():
    """Flask CLI command: `flask init-db`."""
    init_db()
    print("Initialized the database.")


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #
def current_author():
    """Return the logged-in author row, or None."""
    author_id = session.get("author_id")
    if author_id is None:
        return None
    return get_db().execute(
        "SELECT * FROM authors WHERE id = ?", (author_id,)
    ).fetchone()


@app.context_processor
def inject_author():
    return {"current_author": current_author()}


def login_required(view):
    """Decorator that redirects anonymous users to the login page."""
    from functools import wraps

    @wraps(view)
    def wrapped(*args, **kwargs):
        if current_author() is None:
            flash("Please log in to publish articles.")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# --------------------------------------------------------------------------- #
# Routes: articles
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    db = get_db()
    articles = db.execute(
        """
        SELECT a.id, a.title, a.body, a.created_at, au.username AS author,
               (SELECT COUNT(*) FROM comments c WHERE c.article_id = a.id)
                   AS comment_count
        FROM articles a
        JOIN authors au ON au.id = a.author_id
        ORDER BY a.created_at DESC, a.id DESC
        """
    ).fetchall()
    return render_template("index.html", articles=articles)


@app.route("/article/<int:article_id>")
def article(article_id):
    db = get_db()
    art = db.execute(
        """
        SELECT a.id, a.title, a.body, a.created_at, au.username AS author
        FROM articles a
        JOIN authors au ON au.id = a.author_id
        WHERE a.id = ?
        """,
        (article_id,),
    ).fetchone()
    if art is None:
        abort(404)
    comments = db.execute(
        "SELECT * FROM comments WHERE article_id = ? ORDER BY created_at ASC, id ASC",
        (article_id,),
    ).fetchall()
    return render_template("article.html", article=art, comments=comments)


@app.route("/publish", methods=["GET", "POST"])
@login_required
def publish():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()
        if not title or not body:
            flash("Both a title and a body are required.")
        else:
            db = get_db()
            db.execute(
                "INSERT INTO articles (title, body, author_id, created_at) "
                "VALUES (?, ?, ?, ?)",
                (title, body, session["author_id"], datetime.utcnow().isoformat(timespec="seconds")),
            )
            db.commit()
            flash("Article published.")
            return redirect(url_for("index"))
    return render_template("publish.html")


# --------------------------------------------------------------------------- #
# Routes: comments (open to all visitors)
# --------------------------------------------------------------------------- #
@app.route("/article/<int:article_id>/comment", methods=["POST"])
def add_comment(article_id):
    db = get_db()
    exists = db.execute(
        "SELECT 1 FROM articles WHERE id = ?", (article_id,)
    ).fetchone()
    if exists is None:
        abort(404)

    name = request.form.get("author_name", "").strip() or "Anonymous"
    body = request.form.get("body", "").strip()
    if not body:
        flash("Comment cannot be empty.")
    else:
        db.execute(
            "INSERT INTO comments (article_id, author_name, body, created_at) "
            "VALUES (?, ?, ?, ?)",
            (article_id, name, body, datetime.utcnow().isoformat(timespec="seconds")),
        )
        db.commit()
        flash("Comment posted.")
    return redirect(url_for("article", article_id=article_id) + "#comments")


# --------------------------------------------------------------------------- #
# Routes: auth
# --------------------------------------------------------------------------- #
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()
        error = None
        if not username or not password:
            error = "Username and password are required."
        elif db.execute(
            "SELECT 1 FROM authors WHERE username = ?", (username,)
        ).fetchone():
            error = f"User '{username}' is already registered."

        if error is None:
            db.execute(
                "INSERT INTO authors (username, password_hash, created_at) "
                "VALUES (?, ?, ?)",
                (username, generate_password_hash(password), datetime.utcnow().isoformat(timespec="seconds")),
            )
            db.commit()
            flash("Registration successful. Please log in.")
            return redirect(url_for("login"))
        flash(error)
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        author = get_db().execute(
            "SELECT * FROM authors WHERE username = ?", (username,)
        ).fetchone()
        if author is None or not check_password_hash(author["password_hash"], password):
            flash("Incorrect username or password.")
        else:
            session.clear()
            session["author_id"] = author["id"]
            flash(f"Welcome back, {author['username']}.")
            next_url = request.args.get("next") or url_for("index")
            return redirect(next_url)
    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.")
    return redirect(url_for("index"))


# --------------------------------------------------------------------------- #
# Entrypoint
# --------------------------------------------------------------------------- #
with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5042, debug=True)
