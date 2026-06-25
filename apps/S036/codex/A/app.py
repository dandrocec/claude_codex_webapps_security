import os
import sqlite3
from datetime import datetime
from functools import wraps

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
from markupsafe import Markup
from werkzeug.security import check_password_hash, generate_password_hash


DATABASE = os.environ.get("WIKI_DATABASE", "wiki.db")


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
    app.config["DATABASE"] = DATABASE

    @app.before_request
    def load_logged_in_user():
        user_id = session.get("user_id")
        g.user = None
        if user_id is not None:
            g.user = query_db(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
                one=True,
            )

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.template_filter("markdown")
    def render_markdown(value):
        html = markdown.markdown(
            value or "",
            extensions=["extra", "sane_lists", "toc"],
            output_format="html5",
        )
        allowed_tags = set(bleach.sanitizer.ALLOWED_TAGS).union(
            {
                "blockquote",
                "br",
                "code",
                "dd",
                "div",
                "dl",
                "dt",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "hr",
                "img",
                "li",
                "ol",
                "p",
                "pre",
                "span",
                "table",
                "tbody",
                "td",
                "th",
                "thead",
                "tr",
                "ul",
            }
        )
        allowed_attributes = {
            **bleach.sanitizer.ALLOWED_ATTRIBUTES,
            "*": ["id", "class"],
            "a": ["href", "title", "rel"],
            "img": ["alt", "src", "title"],
            "td": ["align"],
            "th": ["align"],
        }
        clean = bleach.clean(
            html,
            tags=allowed_tags,
            attributes=allowed_attributes,
            protocols=["http", "https", "mailto"],
            strip=True,
        )
        return Markup(clean)

    @app.route("/")
    def index():
        pages = query_db(
            """
            SELECT id, title, slug, updated_at
            FROM pages
            ORDER BY lower(title)
            """
        )
        return render_template("index.html", pages=pages)

    @app.route("/search")
    def search():
        q = request.args.get("q", "").strip()
        pages = []
        if q:
            pages = query_db(
                """
                SELECT id, title, slug, updated_at
                FROM pages
                WHERE title LIKE ?
                ORDER BY lower(title)
                """,
                (f"%{q}%",),
            )
        return render_template("search.html", pages=pages, q=q)

    @app.route("/page/<slug>")
    def view_page(slug):
        page = get_page_or_404(slug)
        return render_template("page.html", page=page)

    @app.route("/page/new", methods=("GET", "POST"))
    @login_required
    def new_page():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            body = request.form.get("body", "").strip()
            errors = validate_page(title, body)
            slug = slugify(title)

            if not errors:
                existing = query_db(
                    "SELECT id FROM pages WHERE slug = ?",
                    (slug,),
                    one=True,
                )
                if existing:
                    errors.append("A page with that title already exists.")

            if errors:
                for error in errors:
                    flash(error, "error")
            else:
                now = utc_now()
                db = get_db()
                db.execute(
                    """
                    INSERT INTO pages (title, slug, body, author_id, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (title, slug, body, session["user_id"], now, now),
                )
                db.commit()
                flash("Page created.", "success")
                return redirect(url_for("view_page", slug=slug))

        return render_template("edit.html", page=None)

    @app.route("/page/<slug>/edit", methods=("GET", "POST"))
    @login_required
    def edit_page(slug):
        page = get_page_or_404(slug)

        if request.method == "POST":
            title = request.form.get("title", "").strip()
            body = request.form.get("body", "").strip()
            errors = validate_page(title, body)
            new_slug = slugify(title)

            if not errors and new_slug != slug:
                existing = query_db(
                    "SELECT id FROM pages WHERE slug = ? AND id != ?",
                    (new_slug, page["id"]),
                    one=True,
                )
                if existing:
                    errors.append("A page with that title already exists.")

            if errors:
                for error in errors:
                    flash(error, "error")
            else:
                db = get_db()
                db.execute(
                    """
                    UPDATE pages
                    SET title = ?, slug = ?, body = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (title, new_slug, body, utc_now(), page["id"]),
                )
                db.commit()
                flash("Page updated.", "success")
                return redirect(url_for("view_page", slug=new_slug))

        return render_template("edit.html", page=page)

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            errors = []

            if not username:
                errors.append("Username is required.")
            if not password:
                errors.append("Password is required.")
            if len(password) < 8:
                errors.append("Password must be at least 8 characters.")

            if not errors:
                existing = query_db(
                    "SELECT id FROM users WHERE username = ?",
                    (username,),
                    one=True,
                )
                if existing:
                    errors.append("That username is already taken.")

            if errors:
                for error in errors:
                    flash(error, "error")
            else:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))

        return render_template("auth.html", mode="register")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = query_db(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
                one=True,
            )

            if user is None or not check_password_hash(user["password_hash"], password):
                flash("Invalid username or password.", "error")
            else:
                session.clear()
                session["user_id"] = user["id"]
                flash("Logged in.", "success")
                return redirect(url_for("index"))

        return render_template("auth.html", mode="login")

    @app.route("/logout", methods=("POST",))
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_database())
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_database():
    from flask import current_app

    return current_app.config["DATABASE"]


def query_db(query, args=(), one=False):
    cur = get_db().execute(query, args)
    rows = cur.fetchall()
    cur.close()
    return (rows[0] if rows else None) if one else rows


def init_db():
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
            title TEXT NOT NULL,
            slug TEXT NOT NULL UNIQUE,
            body TEXT NOT NULL,
            author_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (author_id) REFERENCES users (id)
        );

        CREATE INDEX IF NOT EXISTS idx_pages_title ON pages (title);
        CREATE INDEX IF NOT EXISTS idx_pages_slug ON pages (slug);
        """
    )
    db.commit()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def get_page_or_404(slug):
    page = query_db(
        """
        SELECT pages.*, users.username AS author
        FROM pages
        JOIN users ON users.id = pages.author_id
        WHERE pages.slug = ?
        """,
        (slug,),
        one=True,
    )
    if page is None:
        abort(404)
    return page


def validate_page(title, body):
    errors = []
    if not title:
        errors.append("Title is required.")
    if not body:
        errors.append("Markdown body is required.")
    if title and not slugify(title):
        errors.append("Title must contain at least one letter or number.")
    return errors


def slugify(value):
    chars = []
    previous_dash = False
    for char in value.lower():
        if char.isalnum():
            chars.append(char)
            previous_dash = False
        elif not previous_dash:
            chars.append("-")
            previous_dash = True
    return "".join(chars).strip("-")


def utc_now():
    return datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5036, debug=True)
