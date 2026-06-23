"""Application factory and global security configuration."""

from __future__ import annotations

import os
import secrets
import sys
from datetime import timedelta

from dotenv import load_dotenv
from flask import Flask, render_template
from flask_login import LoginManager
from flask_wtf.csrf import CSRFProtect

from . import db, models

csrf = CSRFProtect()
login_manager = LoginManager()


def _resolve_secret_key(is_production: bool) -> str:
    key = os.environ.get("SECRET_KEY")
    if key:
        return key
    if is_production:
        # Never run production with an ephemeral or default secret.
        sys.exit("SECRET_KEY environment variable is required in production.")
    # Development convenience only: ephemeral key (sessions reset on restart).
    print("WARNING: SECRET_KEY not set; using a temporary development key.")
    return secrets.token_hex(32)


def create_app() -> Flask:
    load_dotenv()
    app = Flask(__name__, instance_relative_config=True)

    env = os.environ.get("PORTAL_ENV", "development").lower()
    is_production = env == "production"

    os.makedirs(app.instance_path, exist_ok=True)
    upload_dir = os.environ.get(
        "UPLOAD_DIR", os.path.join(app.instance_path, "uploads")
    )
    os.makedirs(upload_dir, exist_ok=True)

    app.config.update(
        SECRET_KEY=_resolve_secret_key(is_production),
        DATABASE=os.environ.get(
            "DATABASE", os.path.join(app.instance_path, "portal.sqlite3")
        ),
        UPLOAD_DIR=upload_dir,
        # Reject oversized uploads before they are buffered (defence in depth
        # alongside the per-field FileSize validator).
        MAX_CONTENT_LENGTH=5 * 1024 * 1024,
        # --- Secure session cookies -------------------------------------
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure flag requires HTTPS. Enabled by default in production; for
        # local plain-HTTP testing set PORTAL_ENV=development (the default).
        SESSION_COOKIE_SECURE=is_production,
        REMEMBER_COOKIE_HTTPONLY=True,
        REMEMBER_COOKIE_SAMESITE="Lax",
        REMEMBER_COOKIE_SECURE=is_production,
        PERMANENT_SESSION_LIFETIME=timedelta(hours=8),
        WTF_CSRF_TIME_LIMIT=None,
    )

    db.init_app(app)
    csrf.init_app(app)

    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message_category = "error"
    login_manager.session_protection = "strong"

    @login_manager.user_loader
    def load_user(user_id: str):
        try:
            return models.get_user_by_id(int(user_id))
        except (ValueError, TypeError):
            return None

    _register_blueprints(app)
    _register_error_handlers(app)
    _register_security_headers(app)

    return app


def _register_blueprints(app: Flask) -> None:
    from . import auth, main, profiles

    app.register_blueprint(auth.bp)
    app.register_blueprint(main.bp)
    app.register_blueprint(profiles.bp)


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        # Strict, self-only CSP. The app uses no inline scripts; styles are in
        # a static file, so 'unsafe-inline' is not required.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; object-src 'none'; "
            "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


def _register_error_handlers(app: Flask) -> None:
    # Generic pages: never leak stack traces or internal details to clients.
    @app.errorhandler(400)
    def bad_request(e):
        return render_template("errors/error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template(
            "errors/error.html", code=403, message="You do not have access to that."
        ), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template(
            "errors/error.html", code=404, message="Page not found."
        ), 404

    @app.errorhandler(413)
    def too_large(e):
        return render_template(
            "errors/error.html", code=413, message="The uploaded file is too large."
        ), 413

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error")
        return render_template(
            "errors/error.html", code=500, message="Something went wrong."
        ), 500
