"""Application factory and extension wiring."""
import logging
import os

from flask import Flask, render_template, request
from flask_sqlalchemy import SQLAlchemy
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from flask_login import LoginManager
from flask_bcrypt import Bcrypt

from config import Config

# Extensions are instantiated at module level and bound to the app inside the
# factory so they can be imported elsewhere without circular imports.
db = SQLAlchemy()
csrf = CSRFProtect()
login_manager = LoginManager()
bcrypt = Bcrypt()


def create_app(config_class: type = Config) -> Flask:
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_object(config_class)

    # Ensure the instance folder (holds the SQLite file) exists.
    os.makedirs(app.instance_path, exist_ok=True)
    os.makedirs(os.path.join(app.root_path, "..", "instance"), exist_ok=True)

    db.init_app(app)
    csrf.init_app(app)
    bcrypt.init_app(app)

    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message_category = "warning"

    from app.models import User

    @login_manager.user_loader
    def load_user(user_id: str):
        # Parameterised lookup via the ORM; user_id comes from the signed
        # session cookie but is still treated as untrusted.
        try:
            return db.session.get(User, int(user_id))
        except (TypeError, ValueError):
            return None

    # Blueprints
    from app.auth import bp as auth_bp
    from app.projects import bp as projects_bp
    from app.main import bp as main_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(projects_bp)
    app.register_blueprint(main_bp)

    _register_security_headers(app)
    _register_error_handlers(app)

    with app.app_context():
        db.create_all()

    return app


def _register_security_headers(app: Flask) -> None:
    """Apply OWASP-recommended response headers to every response."""

    @app.after_request
    def set_security_headers(response):
        # Content Security Policy: only allow resources from our own origin.
        # No inline scripts are used; styles live in a static file.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        # Only advertise HSTS when actually served over HTTPS.
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


def _register_error_handlers(app: Flask) -> None:
    """Return generic error pages; never leak stack traces to clients."""

    if not app.debug:
        logging.basicConfig(level=logging.INFO)

    @app.errorhandler(CSRFError)
    def handle_csrf_error(e):
        return render_template("errors/error.html", code=400,
                               message="The form expired or was tampered with. "
                                       "Please try again."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("errors/error.html", code=403,
                               message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("errors/error.html", code=404,
                               message="The page you requested was not found."), 404

    @app.errorhandler(413)
    def too_large(e):
        return render_template("errors/error.html", code=413,
                               message="The request was too large."), 413

    @app.errorhandler(500)
    def server_error(e):
        # Log the real error server-side; show a generic message to the user.
        app.logger.exception("Unhandled server error")
        return render_template("errors/error.html", code=500,
                               message="An unexpected error occurred."), 500
