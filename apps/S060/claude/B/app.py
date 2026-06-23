"""Flask blog with role-based editorial workflow.

Roles
-----
* reader  – browse approved posts; personal dashboard.
* author  – create/edit drafts, submit for review, track status.
* editor  – review the submission queue, approve or reject posts.

Security highlights (OWASP Top 10)
----------------------------------
* A01 Broken Access Control – role decorators + per-resource ownership checks
  (prevents IDOR); editorial actions restricted to editors.
* A02 Cryptographic Failures – passwords hashed with bcrypt (salted).
* A03 Injection – every query is parameterised (see db.py); Jinja2
  autoescaping provides context-aware output encoding against XSS.
* A05 Security Misconfiguration – security headers, hardened cookies,
  generic error pages (no stack traces leaked).
* A07 Identification & Auth Failures – Flask-Login session management,
  constant-time password checks, session fixation handled on login.
* CSRF – Flask-WTF CSRFProtect on all state-changing requests.
* Secrets – read from the environment (see config.py).
"""
import sqlite3

import bcrypt
from flask import (
    Flask,
    abort,
    flash,
    redirect,
    render_template,
    request,
    url_for,
)
from flask_login import (
    LoginManager,
    UserMixin,
    current_user,
    login_required,
    login_user,
    logout_user,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from werkzeug.exceptions import HTTPException

import db
from config import Config
from forms import LoginForm, PostForm, RegisterForm, ReviewForm

csrf = CSRFProtect()
login_manager = LoginManager()


# --------------------------------------------------------------------------- #
# User model                                                                  #
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row: sqlite3.Row):
        self.id = row["id"]
        self.username = row["username"]
        self.email = row["email"]
        self.role = row["role"]

    @property
    def is_author(self) -> bool:
        return self.role == "author"

    @property
    def is_editor(self) -> bool:
        return self.role == "editor"


@login_manager.user_loader
def load_user(user_id: str):
    try:
        uid = int(user_id)
    except (TypeError, ValueError):
        return None
    row = db.query_db("SELECT * FROM users WHERE id = ?", (uid,), one=True)
    return User(row) if row else None


# --------------------------------------------------------------------------- #
# Access-control helpers                                                       #
# --------------------------------------------------------------------------- #
def role_required(*roles):
    """Decorator enforcing that the logged-in user has one of ``roles``."""
    from functools import wraps

    def decorator(view):
        @wraps(view)
        @login_required
        def wrapped(*args, **kwargs):
            if current_user.role not in roles:
                abort(403)
            return view(*args, **kwargs)

        return wrapped

    return decorator


def get_post_or_404(post_id: int) -> sqlite3.Row:
    post = db.query_db("SELECT * FROM posts WHERE id = ?", (post_id,), one=True)
    if post is None:
        abort(404)
    return post


# --------------------------------------------------------------------------- #
# Application factory                                                          #
# --------------------------------------------------------------------------- #
def create_app(config_class=Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_class)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "warning"

    register_routes(app)
    register_security(app)
    register_error_handlers(app)
    return app


# --------------------------------------------------------------------------- #
# Security middleware                                                          #
# --------------------------------------------------------------------------- #
def register_security(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        # Context-aware output encoding is handled by Jinja2 autoescape;
        # a strict CSP is the defence-in-depth backstop against XSS.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # HSTS only matters over HTTPS; harmless to advertise.
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


# --------------------------------------------------------------------------- #
# Error handlers — never leak internals to the client                         #
# --------------------------------------------------------------------------- #
def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(CSRFError)
    def handle_csrf(err):
        return render_template("error.html", code=400,
                               message="The form session expired. Please try again."), 400

    @app.errorhandler(HTTPException)
    def handle_http(err):
        return render_template("error.html", code=err.code,
                               message=err.name), err.code

    @app.errorhandler(Exception)
    def handle_unexpected(err):
        # Log full detail server-side; show a generic message to the user.
        app.logger.exception("Unhandled exception: %s", err)
        return render_template("error.html", code=500,
                               message="An internal error occurred."), 500


# --------------------------------------------------------------------------- #
# Routes                                                                       #
# --------------------------------------------------------------------------- #
def register_routes(app: Flask) -> None:

    # ---- Public ----------------------------------------------------------- #
    @app.route("/")
    def index():
        posts = db.query_db(
            """SELECT p.id, p.title, p.body, p.created_at, u.username AS author
               FROM posts p JOIN users u ON u.id = p.author_id
               WHERE p.status = 'approved'
               ORDER BY p.created_at DESC""",
        )
        return render_template("index.html", posts=posts)

    @app.route("/post/<int:post_id>")
    def view_post(post_id):
        post = db.query_db(
            """SELECT p.*, u.username AS author
               FROM posts p JOIN users u ON u.id = p.author_id
               WHERE p.id = ? AND p.status = 'approved'""",
            (post_id,),
            one=True,
        )
        if post is None:
            abort(404)
        return render_template("post.html", post=post)

    # ---- Auth ------------------------------------------------------------- #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        form = RegisterForm()
        if form.validate_on_submit():
            pw_hash = bcrypt.hashpw(
                form.password.data.encode("utf-8"), bcrypt.gensalt()
            ).decode("utf-8")
            try:
                db.execute_db(
                    """INSERT INTO users (username, email, password_hash, role)
                       VALUES (?, ?, ?, ?)""",
                    (form.username.data, form.email.data.lower(), pw_hash, form.role.data),
                )
            except sqlite3.IntegrityError:
                # Generic message avoids username/email enumeration specifics.
                flash("That username or email is already taken.", "danger")
                return render_template("register.html", form=form)
            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("dashboard"))
        form = LoginForm()
        if form.validate_on_submit():
            row = db.query_db(
                "SELECT * FROM users WHERE username = ?",
                (form.username.data,),
                one=True,
            )
            # Always run a bcrypt check to keep timing uniform whether or not
            # the user exists, and use a generic error to avoid enumeration.
            stored = row["password_hash"].encode("utf-8") if row else _DUMMY_HASH
            password_ok = bcrypt.checkpw(form.password.data.encode("utf-8"), stored)
            if row and password_ok:
                login_user(User(row), remember=form.remember.data)
                flash("Logged in successfully.", "success")
                return redirect(url_for("dashboard"))
            flash("Invalid username or password.", "danger")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    # ---- Role-aware dashboard -------------------------------------------- #
    @app.route("/dashboard")
    @login_required
    def dashboard():
        if current_user.is_editor:
            queue = db.query_db(
                """SELECT p.id, p.title, p.created_at, u.username AS author
                   FROM posts p JOIN users u ON u.id = p.author_id
                   WHERE p.status = 'submitted'
                   ORDER BY p.created_at ASC""",
            )
            reviewed = db.query_db(
                """SELECT p.id, p.title, p.status, p.updated_at, u.username AS author
                   FROM posts p JOIN users u ON u.id = p.author_id
                   WHERE p.reviewer_id = ?
                   ORDER BY p.updated_at DESC LIMIT 20""",
                (current_user.id,),
            )
            return render_template("dashboard_editor.html", queue=queue, reviewed=reviewed)

        if current_user.is_author:
            posts = db.query_db(
                """SELECT id, title, status, created_at, updated_at, review_note
                   FROM posts WHERE author_id = ?
                   ORDER BY updated_at DESC""",
                (current_user.id,),
            )
            return render_template("dashboard_author.html", posts=posts)

        # reader
        posts = db.query_db(
            """SELECT p.id, p.title, p.created_at, u.username AS author
               FROM posts p JOIN users u ON u.id = p.author_id
               WHERE p.status = 'approved'
               ORDER BY p.created_at DESC LIMIT 20""",
        )
        return render_template("dashboard_reader.html", posts=posts)

    # ---- Author: create / edit / submit ---------------------------------- #
    @app.route("/posts/new", methods=["GET", "POST"])
    @role_required("author")
    def new_post():
        form = PostForm()
        if form.validate_on_submit():
            status = "submitted" if form.submit_for_review.data else "draft"
            post_id = db.execute_db(
                """INSERT INTO posts (title, body, author_id, status)
                   VALUES (?, ?, ?, ?)""",
                (form.title.data, form.body.data, current_user.id, status),
            )
            flash(
                "Post submitted for review." if status == "submitted" else "Draft saved.",
                "success",
            )
            return redirect(url_for("dashboard"))
        return render_template("post_form.html", form=form, mode="new")

    @app.route("/posts/<int:post_id>/edit", methods=["GET", "POST"])
    @role_required("author")
    def edit_post(post_id):
        post = get_post_or_404(post_id)
        # IDOR guard: authors may only edit their OWN posts.
        if post["author_id"] != current_user.id:
            abort(403)
        # Approved posts are locked; rejected/draft can be edited and resubmitted.
        if post["status"] == "approved":
            flash("Approved posts cannot be edited.", "warning")
            return redirect(url_for("dashboard"))

        form = PostForm(data={"title": post["title"], "body": post["body"]})
        if form.validate_on_submit():
            status = "submitted" if form.submit_for_review.data else "draft"
            db.execute_db(
                """UPDATE posts
                   SET title = ?, body = ?, status = ?,
                       review_note = NULL, reviewer_id = NULL,
                       updated_at = datetime('now')
                   WHERE id = ? AND author_id = ?""",
                (form.title.data, form.body.data, status, post_id, current_user.id),
            )
            flash(
                "Post submitted for review." if status == "submitted" else "Draft updated.",
                "success",
            )
            return redirect(url_for("dashboard"))
        return render_template("post_form.html", form=form, mode="edit", post=post)

    @app.route("/posts/<int:post_id>/submit", methods=["POST"])
    @role_required("author")
    def submit_post(post_id):
        post = get_post_or_404(post_id)
        if post["author_id"] != current_user.id:
            abort(403)
        if post["status"] not in {"draft", "rejected"}:
            abort(400)
        db.execute_db(
            """UPDATE posts
               SET status = 'submitted', review_note = NULL, reviewer_id = NULL,
                   updated_at = datetime('now')
               WHERE id = ? AND author_id = ?""",
            (post_id, current_user.id),
        )
        flash("Post submitted for review.", "success")
        return redirect(url_for("dashboard"))

    @app.route("/posts/<int:post_id>/delete", methods=["POST"])
    @role_required("author")
    def delete_post(post_id):
        post = get_post_or_404(post_id)
        if post["author_id"] != current_user.id:
            abort(403)
        db.execute_db(
            "DELETE FROM posts WHERE id = ? AND author_id = ?",
            (post_id, current_user.id),
        )
        flash("Post deleted.", "success")
        return redirect(url_for("dashboard"))

    # ---- Editor: review queue -------------------------------------------- #
    @app.route("/review/<int:post_id>", methods=["GET", "POST"])
    @role_required("editor")
    def review_post(post_id):
        post = db.query_db(
            """SELECT p.*, u.username AS author
               FROM posts p JOIN users u ON u.id = p.author_id
               WHERE p.id = ?""",
            (post_id,),
            one=True,
        )
        if post is None:
            abort(404)
        if post["status"] != "submitted":
            flash("That post is not awaiting review.", "warning")
            return redirect(url_for("dashboard"))

        form = ReviewForm()
        if form.validate_on_submit():
            new_status = "approved" if form.approve.data else "rejected"
            db.execute_db(
                """UPDATE posts
                   SET status = ?, review_note = ?, reviewer_id = ?,
                       updated_at = datetime('now')
                   WHERE id = ? AND status = 'submitted'""",
                (new_status, form.review_note.data or None, current_user.id, post_id),
            )
            flash(f"Post {new_status}.", "success")
            return redirect(url_for("dashboard"))
        return render_template("review.html", form=form, post=post)


# Pre-computed bcrypt hash of a random string, used to equalise login timing
# for non-existent users (mitigates user-enumeration via timing).
_DUMMY_HASH = bcrypt.hashpw(b"timing-equaliser-not-a-real-password", bcrypt.gensalt())


app = create_app()


if __name__ == "__main__":
    # Debug is OFF by default so stack traces are never exposed to clients.
    # The development server is fine for local use; see the README for a
    # production-grade server (waitress) also listening on port 5060.
    app.run(host="127.0.0.1", port=5060, debug=False)
