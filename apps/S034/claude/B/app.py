"""Application factory and global security configuration.

Run locally:  python app.py   (serves on http://127.0.0.1:5034)
"""
import os
import secrets

from dotenv import load_dotenv
from flask import Flask, render_template
from flask_wtf.csrf import CSRFProtect

import db
from auth import bp as auth_bp, login_manager
from books import bp as books_bp

load_dotenv()

csrf = CSRFProtect()


def _get_secret_key() -> str:
    """Read SECRET_KEY from the environment; never hardcode it.

    In production a missing key is a hard error. For local convenience we fall
    back to a random per-process key (sessions won't survive a restart).
    """
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    if os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError("SECRET_KEY environment variable is required in production.")
    return secrets.token_hex(32)


def create_app() -> Flask:
    app = Flask(__name__)

    # HTTPS-only cookies: on by default in production, relaxed in development
    # so the app is runnable over plain http locally. Can be forced either way
    # with the SESSION_COOKIE_SECURE env var ("1" / "0").
    env = os.environ.get("FLASK_ENV", "development")
    default_secure = "1" if env == "production" else "0"
    secure_cookies = os.environ.get("SESSION_COOKIE_SECURE", default_secure) != "0"

    app.config.update(
        SECRET_KEY=_get_secret_key(),
        DATABASE=os.environ.get(
            "DATABASE", os.path.join(app.instance_path, "reading_list.sqlite3")
        ),
        # --- Secure session cookies -------------------------------------
        SESSION_COOKIE_HTTPONLY=True,      # not readable by JavaScript
        SESSION_COOKIE_SECURE=secure_cookies,  # only sent over HTTPS
        SESSION_COOKIE_SAMESITE="Lax",     # mitigates CSRF on top-level nav
        # --- CSRF -------------------------------------------------------
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=256 * 1024,     # cap request body size
    )

    os.makedirs(app.instance_path, exist_ok=True)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)

    app.register_blueprint(auth_bp)
    app.register_blueprint(books_bp)

    with app.app_context():
        db.init_db()

    _register_security_headers(app)
    _register_error_handlers(app)
    return app


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        csp = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self'; "
            "script-src 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'self'"
        )
        response.headers["Content-Security-Policy"] = csp
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response


def _register_error_handlers(app: Flask) -> None:
    """Return generic pages; never leak stack traces or internals."""

    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403, message="Forbidden."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404, message="Not found."), 404

    @app.errorhandler(500)
    def server_error(_e):
        app.logger.exception("Unhandled server error")
        return (
            render_template(
                "error.html", code=500, message="Something went wrong."
            ),
            500,
        )


app = create_app()


if __name__ == "__main__":
    # debug=False ensures the interactive debugger / tracebacks are never
    # exposed to clients.
    app.run(host="127.0.0.1", port=5034, debug=False)
