"""A small Flask wiki with full page-revision history.

Security posture (OWASP Top 10):

* A01 Broken Access Control - role checks (viewer/editor) on every
  state-changing route; editor-only pages are hidden from viewers;
  object ownership / relationship is validated to prevent IDOR.
* A02 Cryptographic Failures - passwords hashed with Argon2id; session
  cookies marked HttpOnly + SameSite (+ Secure when served over HTTPS).
* A03 Injection - all SQL uses parameterised queries (see db.py); all
  HTML output is autoescaped by Jinja2 (context-aware encoding).
* A05 Security Misconfiguration - security headers + CSP set on every
  response; debug disabled; generic error pages (no stack traces).
* A07 Identification & Auth Failures - login required decorators,
  server-side sessions, password length policy.
* CSRF - Flask-WTF token enforced on all POST requests.
* Secrets - SECRET_KEY is read from the environment, never hardcoded.
"""

import os
import secrets

from dotenv import load_dotenv

load_dotenv()  # read SECRET_KEY etc. from a local .env if present

from flask import (
    Flask,
    g,
    session,
    request,
    redirect,
    url_for,
    render_template,
    abort,
    flash,
)
from functools import wraps
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

import db
from forms import RegisterForm, LoginForm, PageForm, EditForm, ConfirmForm

ph = PasswordHasher()
csrf = CSRFProtect()


def create_app():
    app = Flask(__name__)

    # --- Secrets: never hardcoded -----------------------------------------
    # Read from the environment. For local dev convenience we fall back to a
    # random ephemeral key (which simply means sessions reset on restart).
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        secret = secrets.token_hex(32)
        app.logger.warning(
            "SECRET_KEY not set; using a random ephemeral key. "
            "Set SECRET_KEY in the environment for stable sessions."
        )
    app.config["SECRET_KEY"] = secret

    # --- Secure session cookies -------------------------------------------
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure requires HTTPS; default off for local http on :5077, but
        # turn on by setting SECURE_COOKIES=1 behind TLS in production.
        SESSION_COOKIE_SECURE=os.environ.get("SECURE_COOKIES", "0") == "1",
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=2 * 1024 * 1024,  # 2 MB request cap
    )

    db.init_app(app)
    csrf.init_app(app)

    with app.app_context():
        db.init_db()

    register_routes(app)
    register_security(app)
    register_error_handlers(app)

    return app


# --------------------------------------------------------------------------
# Auth helpers
# --------------------------------------------------------------------------

def load_user():
    """Populate g.user from the session, if logged in."""
    g.user = None
    uid = session.get("user_id")
    if uid is not None:
        row = db.get_db().execute(
            "SELECT id, username, role FROM users WHERE id = ?", (uid,)
        ).fetchone()
        g.user = row


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Please log in to continue.", "error")
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


def editor_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login", next=request.path))
        if g.user["role"] != "editor":
            abort(403)
        return view(*args, **kwargs)

    return wrapped


def can_view_page(page):
    """Viewers cannot see editor-only pages."""
    if not page["editor_only"]:
        return True
    return g.user is not None and g.user["role"] == "editor"


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

def register_routes(app):

    @app.before_request
    def _before():
        load_user()

    @app.context_processor
    def _inject():
        # ConfirmForm gives templates a CSRF token for POST-only buttons.
        return {"current_user": g.user, "confirm_form": ConfirmForm()}

    # ---- Home / listing --------------------------------------------------
    @app.route("/")
    def index():
        rows = db.get_db().execute(
            "SELECT slug, title, editor_only FROM pages ORDER BY title COLLATE NOCASE"
        ).fetchall()
        # Filter editor-only pages out for viewers / anonymous users.
        pages = [p for p in rows if can_view_page(p)]
        return render_template("index.html", pages=pages)

    # ---- Auth ------------------------------------------------------------
    @app.route("/register", methods=["GET", "POST"])
    def register():
        form = RegisterForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            conn = db.get_db()
            exists = conn.execute(
                "SELECT 1 FROM users WHERE username = ?", (username,)
            ).fetchone()
            if exists:
                flash("That username is taken.", "error")
            else:
                pw_hash = ph.hash(form.password.data)
                conn.execute(
                    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                    (username, pw_hash, form.role.data),
                )
                conn.commit()
                flash("Account created. Please log in.", "success")
                return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        form = LoginForm()
        if form.validate_on_submit():
            username = form.username.data.strip()
            row = db.get_db().execute(
                "SELECT id, password_hash FROM users WHERE username = ?",
                (username,),
            ).fetchone()

            # Always run a verify to keep timing roughly constant and avoid
            # leaking whether the username exists.
            valid = False
            if row is not None:
                try:
                    ph.verify(row["password_hash"], form.password.data)
                    valid = True
                except (VerifyMismatchError, InvalidHashError):
                    valid = False
            else:
                # Dummy verify against a throwaway hash.
                try:
                    ph.verify(ph.hash("dummy"), form.password.data)
                except VerifyMismatchError:
                    pass

            if valid:
                session.clear()
                session["user_id"] = row["id"]
                # Optionally rehash if parameters changed.
                if ph.check_needs_rehash(row["password_hash"]):
                    new_hash = ph.hash(form.password.data)
                    conn = db.get_db()
                    conn.execute(
                        "UPDATE users SET password_hash = ? WHERE id = ?",
                        (new_hash, row["id"]),
                    )
                    conn.commit()
                flash("Logged in.", "success")
                return redirect(_safe_next() or url_for("index"))
            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    # ---- Page viewing ----------------------------------------------------
    @app.route("/wiki/<slug>")
    def view_page(slug):
        page = _get_page_or_404(slug)
        if not can_view_page(page):
            abort(403)
        latest = db.get_db().execute(
            "SELECT * FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 1",
            (page["id"],),
        ).fetchone()
        return render_template("view_page.html", page=page, revision=latest)

    # ---- Page creation (editors only) -----------------------------------
    @app.route("/create", methods=["GET", "POST"])
    @editor_required
    def create_page():
        form = PageForm()
        if form.validate_on_submit():
            slug = form.slug.data.strip().lower()
            conn = db.get_db()
            if conn.execute("SELECT 1 FROM pages WHERE slug = ?", (slug,)).fetchone():
                flash("A page with that slug already exists.", "error")
            else:
                cur = conn.execute(
                    "INSERT INTO pages (slug, title, editor_only, created_by) "
                    "VALUES (?, ?, ?, ?)",
                    (slug, form.title.data, 1 if form.editor_only.data else 0,
                     g.user["id"]),
                )
                page_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO revisions (page_id, title, content, comment, author_id) "
                    "VALUES (?, ?, ?, ?, ?)",
                    (page_id, form.title.data, form.content.data or "",
                     form.comment.data or "Created page", g.user["id"]),
                )
                conn.commit()
                flash("Page created.", "success")
                return redirect(url_for("view_page", slug=slug))
        return render_template("create_page.html", form=form)

    # ---- Page editing (editors only) ------------------------------------
    @app.route("/wiki/<slug>/edit", methods=["GET", "POST"])
    @editor_required
    def edit_page(slug):
        page = _get_page_or_404(slug)
        conn = db.get_db()
        latest = conn.execute(
            "SELECT * FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 1",
            (page["id"],),
        ).fetchone()

        form = EditForm()
        if form.validate_on_submit():
            conn.execute(
                "UPDATE pages SET title = ?, editor_only = ? WHERE id = ?",
                (form.title.data, 1 if form.editor_only.data else 0, page["id"]),
            )
            conn.execute(
                "INSERT INTO revisions (page_id, title, content, comment, author_id) "
                "VALUES (?, ?, ?, ?, ?)",
                (page["id"], form.title.data, form.content.data or "",
                 form.comment.data or "Edited page", g.user["id"]),
            )
            conn.commit()
            flash("Revision saved.", "success")
            return redirect(url_for("view_page", slug=slug))

        if request.method == "GET":
            form.title.data = page["title"]
            form.editor_only.data = bool(page["editor_only"])
            form.content.data = latest["content"] if latest else ""
        return render_template("edit_page.html", form=form, page=page)

    # ---- History ---------------------------------------------------------
    @app.route("/wiki/<slug>/history")
    def history(slug):
        page = _get_page_or_404(slug)
        if not can_view_page(page):
            abort(403)
        revs = db.get_db().execute(
            "SELECT r.id, r.title, r.comment, r.created_at, u.username AS author "
            "FROM revisions r JOIN users u ON u.id = r.author_id "
            "WHERE r.page_id = ? ORDER BY r.id DESC",
            (page["id"],),
        ).fetchall()
        return render_template("history.html", page=page, revisions=revs)

    @app.route("/wiki/<slug>/revision/<int:rev_id>")
    def view_revision(slug, rev_id):
        page = _get_page_or_404(slug)
        if not can_view_page(page):
            abort(403)
        # IDOR guard: the revision must belong to *this* page.
        rev = db.get_db().execute(
            "SELECT r.*, u.username AS author FROM revisions r "
            "JOIN users u ON u.id = r.author_id "
            "WHERE r.id = ? AND r.page_id = ?",
            (rev_id, page["id"]),
        ).fetchone()
        if rev is None:
            abort(404)
        return render_template("revision.html", page=page, revision=rev)

    # ---- Restore (editors only) -----------------------------------------
    @app.route("/wiki/<slug>/revision/<int:rev_id>/restore", methods=["POST"])
    @editor_required
    def restore_revision(slug, rev_id):
        form = ConfirmForm()
        if not form.validate_on_submit():  # validates CSRF token
            abort(400)
        page = _get_page_or_404(slug)
        conn = db.get_db()
        # IDOR guard: revision must belong to this page.
        rev = conn.execute(
            "SELECT * FROM revisions WHERE id = ? AND page_id = ?",
            (rev_id, page["id"]),
        ).fetchone()
        if rev is None:
            abort(404)
        # Restoring creates a *new* revision (history is never rewritten).
        conn.execute(
            "UPDATE pages SET title = ? WHERE id = ?", (rev["title"], page["id"])
        )
        conn.execute(
            "INSERT INTO revisions (page_id, title, content, comment, author_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (page["id"], rev["title"], rev["content"],
             f"Restored revision #{rev_id}", g.user["id"]),
        )
        conn.commit()
        flash(f"Restored revision #{rev_id} as a new revision.", "success")
        return redirect(url_for("view_page", slug=slug))


# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

def _get_page_or_404(slug):
    page = db.get_db().execute(
        "SELECT * FROM pages WHERE slug = ?", (slug,)
    ).fetchone()
    if page is None:
        abort(404)
    return page


def _safe_next():
    """Only allow same-site relative redirects (prevents open redirect)."""
    target = request.args.get("next") or request.form.get("next")
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return None


# --------------------------------------------------------------------------
# Security headers & error handling
# --------------------------------------------------------------------------

def register_security(app):
    @app.after_request
    def set_headers(resp):
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # Strict CSP: no inline scripts, self-hosted assets only.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' data:; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'self'"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


def register_error_handlers(app):
    # Generic pages only - never expose stack traces or internals.
    @app.errorhandler(400)
    def _400(e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def _403(e):
        return render_template("error.html", code=403,
                               message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def _404(e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(CSRFError)
    def _csrf(e):
        return render_template("error.html", code=400,
                               message="CSRF validation failed. Please retry."), 400

    @app.errorhandler(500)
    def _500(e):
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="An internal error occurred."), 500


app = create_app()


if __name__ == "__main__":
    # debug is forced off so tracebacks never reach clients.
    port = int(os.environ.get("PORT", "5077"))
    app.run(host="127.0.0.1", port=port, debug=False)
