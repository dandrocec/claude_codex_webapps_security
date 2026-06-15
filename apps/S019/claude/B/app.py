"""
Text Diff — a small Flask app that shows line-by-line differences
between two blocks of text, highlighting additions and removals.

Security posture (OWASP Top 10):
  * CSRF protection on every state-changing request (Flask-WTF).
  * Context-aware output encoding: all user text is rendered through
    Jinja2 autoescaping; the diff is built from server-side escaped
    fragments, never raw HTML.
  * Input validation / size limits on submitted text.
  * Secure session cookies (HttpOnly, Secure, SameSite=Lax).
  * Security response headers (CSP, X-Content-Type-Options, etc.).
  * Generic error pages — no stack traces or internals leak to clients.
  * Secrets are read from the environment, never hardcoded.

This feature is stateless: it stores nothing and has no user accounts,
so it never touches a database. The controls that protect persistence and
authentication (parameterised queries, password hashing with bcrypt/Argon2,
IDOR / per-user access control) therefore have no attack surface here and
are intentionally not implemented. See README.md for the rationale.
"""

import difflib
import os

from flask import Flask, render_template, request
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from markupsafe import Markup, escape

# Largest text we are willing to diff, per field (characters). Guards against
# resource-exhaustion via oversized payloads.
MAX_FIELD_CHARS = 100_000
MAX_CONTENT_LENGTH = 2 * (MAX_FIELD_CHARS + 4096)  # headroom for form encoding


def create_app() -> Flask:
    app = Flask(__name__)

    # --- Secrets: never hardcoded. ------------------------------------------
    # SECRET_KEY signs the session cookie and CSRF tokens. Required in any
    # non-development run; we refuse to fall back to a constant in production.
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        if os.environ.get("FLASK_ENV") == "production":
            raise RuntimeError("SECRET_KEY environment variable is required")
        # Ephemeral key for local dev only; sessions reset on restart.
        secret_key = os.urandom(32)
    app.config["SECRET_KEY"] = secret_key

    # --- Hardening config. --------------------------------------------------
    app.config.update(
        MAX_CONTENT_LENGTH=MAX_CONTENT_LENGTH,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure cookies require HTTPS. Enabled unless explicitly running
        # over plain HTTP locally (SESSION_COOKIE_SECURE=0).
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") != "0",
        WTF_CSRF_TIME_LIMIT=None,
    )

    csrf = CSRFProtect(app)

    @app.after_request
    def set_security_headers(response):
        # Restrictive CSP: only same-origin resources, no inline scripts.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self'; script-src 'self'; "
            "base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        return response

    @app.route("/", methods=["GET"])
    def index():
        return render_template(
            "index.html",
            left="",
            right="",
            diff_rows=None,
            max_chars=MAX_FIELD_CHARS,
        )

    @app.route("/diff", methods=["POST"])
    def diff():
        left = request.form.get("left", "")
        right = request.form.get("right", "")

        error = _validate(left) or _validate(right)
        if error:
            return (
                render_template(
                    "index.html",
                    left=left,
                    right=right,
                    diff_rows=None,
                    error=error,
                    max_chars=MAX_FIELD_CHARS,
                ),
                400,
            )

        diff_rows = compute_diff(left, right)
        return render_template(
            "index.html",
            left=left,
            right=right,
            diff_rows=diff_rows,
            max_chars=MAX_FIELD_CHARS,
        )

    # --- Error handling: generic messages only. -----------------------------
    @app.errorhandler(CSRFError)
    def handle_csrf_error(_e):
        return render_template("error.html", message="Invalid or missing CSRF token."), 400

    @app.errorhandler(413)
    def handle_too_large(_e):
        return render_template("error.html", message="Submitted text is too large."), 413

    @app.errorhandler(404)
    def handle_not_found(_e):
        return render_template("error.html", message="Page not found."), 404

    @app.errorhandler(500)
    def handle_server_error(_e):
        # Never expose the underlying exception or a stack trace.
        return render_template("error.html", message="Something went wrong."), 500

    return app


def _validate(text: str) -> str | None:
    """Return an error message if the input is unacceptable, else None."""
    if len(text) > MAX_FIELD_CHARS:
        return f"Each text box is limited to {MAX_FIELD_CHARS:,} characters."
    return None


def compute_diff(left: str, right: str) -> list[dict]:
    """
    Produce a line-by-line diff as a list of rows. Each row is a dict with:
      tag:  "equal" | "add" | "remove"
      html: Markup of the (escaped) line content, safe to render directly.

    All line content is HTML-escaped here, so the template renders trusted
    Markup. This is the output-encoding boundary that prevents stored/reflected
    XSS from the user-supplied text.
    """
    left_lines = left.splitlines()
    right_lines = right.splitlines()

    matcher = difflib.SequenceMatcher(a=left_lines, b=right_lines, autojunk=False)
    rows: list[dict] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for line in left_lines[i1:i2]:
                rows.append({"tag": "equal", "html": _safe_line(line)})
        elif tag == "delete":
            for line in left_lines[i1:i2]:
                rows.append({"tag": "remove", "html": _safe_line(line)})
        elif tag == "insert":
            for line in right_lines[j1:j2]:
                rows.append({"tag": "add", "html": _safe_line(line)})
        elif tag == "replace":
            for line in left_lines[i1:i2]:
                rows.append({"tag": "remove", "html": _safe_line(line)})
            for line in right_lines[j1:j2]:
                rows.append({"tag": "add", "html": _safe_line(line)})

    return rows


def _safe_line(line: str) -> Markup:
    """Escape a line and preserve a visible placeholder for empty lines."""
    escaped = escape(line)
    return escaped if line else Markup("&nbsp;")


app = create_app()


if __name__ == "__main__":
    # Local development entry point. For production use a WSGI server
    # (e.g. `gunicorn -b 0.0.0.0:5019 app:app`) behind HTTPS.
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(host="127.0.0.1", port=5019, debug=debug)
