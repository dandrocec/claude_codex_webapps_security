"""Application factory for the inventory tracker."""
from __future__ import annotations

import os

from dotenv import load_dotenv
from flask import Flask, render_template
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

from .db import close_db, init_app_db
from .auth import login_manager

# Load variables from a local .env file if present (never committed).
load_dotenv()

csrf = CSRFProtect()


def _env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def create_app(test_config: dict | None = None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)

    # --- Secrets: read from the environment, never hardcode. ---
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError(
            "SECRET_KEY environment variable is not set. "
            "Copy .env.example to .env and set a strong random value "
            "(e.g. `python -c \"import secrets; print(secrets.token_hex(32))\"`)."
        )

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get(
            "DATABASE_PATH",
            os.path.join(app.instance_path, "inventory.sqlite3"),
        ),
        # --- Secure session cookies ---
        SESSION_COOKIE_HTTPONLY=True,            # JS cannot read the cookie (XSS mitigation)
        SESSION_COOKIE_SAMESITE="Lax",           # CSRF defence in depth
        SESSION_COOKIE_SECURE=_env_bool("SESSION_COOKIE_SECURE", True),  # HTTPS-only; default secure
        # CSRF tokens also ride the secure cookie rules.
        WTF_CSRF_TIME_LIMIT=3600,
        # Cap request body size to blunt trivial DoS / oversized payloads.
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,
        PERMANENT_SESSION_LIFETIME=60 * 60 * 8,
        # Keep server-side errors out of client responses.
        PROPAGATE_EXCEPTIONS=False,
    )

    if test_config:
        app.config.update(test_config)

    os.makedirs(app.instance_path, exist_ok=True)

    # --- Extensions ---
    csrf.init_app(app)
    login_manager.init_app(app)
    init_app_db(app)
    app.teardown_appcontext(close_db)

    # --- Blueprints ---
    from .auth import bp as auth_bp
    from .items import bp as items_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(items_bp)
    app.add_url_rule("/", endpoint="items.index")

    _register_security_headers(app)
    _register_error_handlers(app)

    return app


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        # Strict, self-only CSP. The app ships no inline scripts.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; "
            "style-src 'self'; script-src 'self'; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; "
            "form-action 'self'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        # Only meaningful over HTTPS; harmless otherwise.
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


def _register_error_handlers(app: Flask) -> None:
    @app.errorhandler(CSRFError)
    def handle_csrf_error(err):  # noqa: ARG001
        return render_template("error.html", code=400,
                               message="The form session expired or was invalid. Please try again."), 400

    @app.errorhandler(400)
    def bad_request(err):  # noqa: ARG001
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(err):  # noqa: ARG001
        return render_template("error.html", code=403, message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(err):  # noqa: ARG001
        return render_template("error.html", code=404, message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(err):  # noqa: ARG001
        return render_template("error.html", code=413, message="Request too large."), 413

    @app.errorhandler(500)
    def server_error(err):
        # Log the real error server-side; never expose internals to the client.
        app.logger.exception("Unhandled server error: %s", err)
        return render_template("error.html", code=500, message="An internal error occurred."), 500
