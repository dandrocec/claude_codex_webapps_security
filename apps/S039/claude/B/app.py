"""Application factory and global security configuration."""
import os
import secrets

from dotenv import load_dotenv
from flask import Flask, render_template
from flask_login import LoginManager
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

import db
from auth import get_user_by_id

load_dotenv()

csrf = CSRFProtect()
login_manager = LoginManager()


def _bool_env(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def create_app() -> Flask:
    app = Flask(__name__)

    # --- Secrets ---------------------------------------------------------
    # Never hardcode the secret key; read it from the environment. A random
    # ephemeral key is used only as a dev fallback (sessions reset on restart).
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        app.logger.warning(
            "SECRET_KEY not set; using a random ephemeral key (dev only)."
        )
        secret_key = secrets.token_hex(32)

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get("DATABASE", os.path.join(app.instance_path, "app.db")),
        # --- Secure session cookies ---
        SESSION_COOKIE_HTTPONLY=True,          # not readable by JavaScript
        SESSION_COOKIE_SAMESITE="Lax",         # mitigates CSRF on top-level nav
        SESSION_COOKIE_SECURE=_bool_env("SESSION_COOKIE_SECURE", True),
        # CSRF tokens valid for the session lifetime.
        WTF_CSRF_TIME_LIMIT=None,
        MAX_CONTENT_LENGTH=1 * 1024 * 1024,    # cap request body size
    )

    os.makedirs(app.instance_path, exist_ok=True)

    # --- Extensions ------------------------------------------------------
    csrf.init_app(app)            # CSRF protection on all state-changing requests
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.session_protection = "strong"
    db.init_app(app)

    @login_manager.user_loader
    def load_user(user_id):
        return get_user_by_id(user_id)

    # --- Blueprints ------------------------------------------------------
    from auth import bp as auth_bp
    from events import bp as events_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(events_bp)

    # --- Security headers ------------------------------------------------
    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; "
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        )
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    # --- Error handlers (no stack traces leaked to clients) --------------
    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        return render_template("error.html", code=400,
                               message="The form session expired. Please try again."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403,
                               message="You do not have permission to do that."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="Something went wrong."), 500

    return app


app = create_app()


if __name__ == "__main__":
    # Debug stays off so internal errors are never exposed to clients.
    app.run(host="127.0.0.1", port=5039, debug=False)
