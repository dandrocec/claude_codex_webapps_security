"""Flask wiki application.

Anyone can read pages; authenticated users can create and edit pages.
See README.md for setup and the security notes throughout this file.
"""
import sqlite3

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from dotenv import load_dotenv
from flask import (
    Flask, render_template, request, redirect, url_for, flash, abort, g,
)
from flask_login import (
    LoginManager, UserMixin, login_user, logout_user, login_required,
    current_user,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

import db as database
from config import Config
from forms import RegisterForm, LoginForm, PageForm, SearchForm
from rendering import render_markdown

load_dotenv()

csrf = CSRFProtect()
login_manager = LoginManager()
password_hasher = PasswordHasher()


class User(UserMixin):
    def __init__(self, row: sqlite3.Row):
        self.id = row["id"]
        self.username = row["username"]
        self.password_hash = row["password_hash"]


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    csrf.init_app(app)
    database.init_app(app)

    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"

    register_routes(app)
    register_security_headers(app)
    register_error_handlers(app)

    return app


@login_manager.user_loader
def load_user(user_id: str):
    db = database.get_db()
    row = db.execute(
        "SELECT id, username, password_hash FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return User(row) if row else None


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        """Page index, newest first. Open to everyone."""
        db = database.get_db()
        pages = db.execute(
            "SELECT p.id, p.title, p.updated_at, u.username AS author "
            "FROM pages p JOIN users u ON u.id = p.author_id "
            "ORDER BY p.updated_at DESC"
        ).fetchall()
        return render_template("index.html", pages=pages, search_form=SearchForm())

    @app.route("/search")
    def search():
        """Search pages by title. Parameterised LIKE query — no injection."""
        form = SearchForm(request.args)
        results = []
        query = (form.q.data or "").strip()
        if query and form.validate():
            db = database.get_db()
            # Escape LIKE wildcards in the user term, then match safely.
            term = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            results = db.execute(
                "SELECT p.id, p.title, p.updated_at, u.username AS author "
                "FROM pages p JOIN users u ON u.id = p.author_id "
                "WHERE p.title LIKE ? ESCAPE '\\' "
                "ORDER BY p.updated_at DESC",
                (f"%{term}%",),
            ).fetchall()
        return render_template(
            "search.html", results=results, query=query, search_form=form
        )

    @app.route("/page/<int:page_id>")
    def view_page(page_id: int):
        """Read a page. Open to everyone."""
        db = database.get_db()
        page = db.execute(
            "SELECT p.id, p.title, p.body, p.created_at, p.updated_at, "
            "p.author_id, u.username AS author "
            "FROM pages p JOIN users u ON u.id = p.author_id "
            "WHERE p.id = ?",
            (page_id,),
        ).fetchone()
        if page is None:
            abort(404)
        # Body is sanitised at render time before being marked safe.
        rendered = render_markdown(page["body"])
        return render_template("page.html", page=page, rendered_body=rendered)

    @app.route("/create", methods=["GET", "POST"])
    @login_required
    def create_page():
        form = PageForm()
        if form.validate_on_submit():
            db = database.get_db()
            try:
                cur = db.execute(
                    "INSERT INTO pages (title, body, author_id) VALUES (?, ?, ?)",
                    (form.title.data.strip(), form.body.data or "", current_user.id),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("A page with that title already exists.", "error")
                return render_template("edit.html", form=form, mode="create")
            flash("Page created.", "success")
            return redirect(url_for("view_page", page_id=cur.lastrowid))
        return render_template("edit.html", form=form, mode="create")

    @app.route("/page/<int:page_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_page(page_id: int):
        db = database.get_db()
        page = db.execute(
            "SELECT id, title, body, author_id FROM pages WHERE id = ?",
            (page_id,),
        ).fetchone()
        if page is None:
            abort(404)
        # Access control: only the author may edit their page (prevents IDOR).
        if page["author_id"] != current_user.id:
            abort(403)

        form = PageForm(data={"title": page["title"], "body": page["body"]})
        if form.validate_on_submit():
            try:
                db.execute(
                    "UPDATE pages SET title = ?, body = ?, "
                    "updated_at = datetime('now') WHERE id = ?",
                    (form.title.data.strip(), form.body.data or "", page_id),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("A page with that title already exists.", "error")
                return render_template("edit.html", form=form, mode="edit", page=page)
            flash("Page updated.", "success")
            return redirect(url_for("view_page", page_id=page_id))
        return render_template("edit.html", form=form, mode="edit", page=page)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            db = database.get_db()
            pw_hash = password_hasher.hash(form.password.data)
            try:
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (form.username.data, pw_hash),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is taken.", "error")
                return render_template("register.html", form=form)
            flash("Account created — please log in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            db = database.get_db()
            row = db.execute(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (form.username.data,),
            ).fetchone()
            if row and _verify_password(row, form.password.data, db):
                login_user(User(row))
                flash("Logged in.", "success")
                next_url = request.args.get("next")
                # Only allow safe, local redirect targets (open-redirect guard).
                if next_url and next_url.startswith("/") and not next_url.startswith("//"):
                    return redirect(next_url)
                return redirect(url_for("index"))
            # Generic message — do not reveal whether the username exists.
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("Logged out.", "success")
        return redirect(url_for("index"))


def _verify_password(row: sqlite3.Row, password: str, db) -> bool:
    """Verify a password against the stored Argon2 hash.

    Transparently re-hashes if Argon2 parameters have been upgraded.
    """
    try:
        password_hasher.verify(row["password_hash"], password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    if password_hasher.check_needs_rehash(row["password_hash"]):
        db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (password_hasher.hash(password), row["id"]),
        )
        db.commit()
    return True


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #
def register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        # Restrictive CSP: only same-origin resources; no inline scripts.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' https: data:; "
            "style-src 'self'; script-src 'self'; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


# --------------------------------------------------------------------------- #
# Error handlers — never leak stack traces or internals to clients
# --------------------------------------------------------------------------- #
def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You don't have permission to do that."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(CSRFError)
    def csrf_error(_e):
        return render_template("error.html", code=400,
                               message="The form session expired. Please try again."), 400

    @app.errorhandler(500)
    def server_error(_e):
        # The real exception is logged server-side, not shown to the user.
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="An internal error occurred."), 500


app = create_app()

if __name__ == "__main__":
    # Bind to localhost on the requested port. Debug stays off so tracebacks
    # are never exposed; set FLASK_DEBUG=1 manually only for development.
    import os
    debug = os.environ.get("FLASK_DEBUG") == "1"
    app.run(host="127.0.0.1", port=5036, debug=debug)
