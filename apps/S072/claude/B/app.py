"""Application factory and entry point.

Run locally:  python app.py   (serves on http://127.0.0.1:5072)
"""
import os

from flask import Flask, g, render_template
from flask_wtf.csrf import CSRFError, CSRFProtect

import db
from config import Config
from security import hash_password, load_logged_in_user

csrf = CSRFProtect()


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    if app.config.get("SECRET_KEY_IS_EPHEMERAL"):
        app.logger.warning(
            "FLASK_SECRET_KEY is not set; using an ephemeral key. Sessions "
            "will reset on restart. Set FLASK_SECRET_KEY in production."
        )

    # CSRF protection for every state-changing (POST) request.
    csrf.init_app(app)
    db.init_app(app)

    # Make the current user available to all views and templates.
    @app.before_request
    def _before():
        load_logged_in_user()

    @app.context_processor
    def _inject_user():
        return {"current_user": g.get("user")}

    _register_blueprints(app)
    _register_security_headers(app)
    _register_error_handlers(app)

    with app.app_context():
        db.init_db()
        _bootstrap_admin(app)

    return app


def _register_blueprints(app: Flask) -> None:
    import auth
    import views
    app.register_blueprint(auth.bp)
    app.register_blueprint(views.bp)


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_headers(resp):
        # Restrictive CSP: no inline scripts, no third-party origins. Combined
        # with Jinja2 autoescaping this strongly mitigates XSS (OWASP A03).
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self'; "
            "style-src 'self'; "
            "img-src 'self' data:; "
            "object-src 'none'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        # HSTS only meaningful over HTTPS; safe to send, browsers ignore on http.
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


def _register_error_handlers(app: Flask) -> None:
    # Never leak stack traces or internals to the client (OWASP A05/A09).
    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You do not have access to that."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(CSRFError)
    def csrf_error(_e):
        return render_template("error.html", code=400,
                               message="The form expired. Please try again."), 400

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error: %s", e)
        return render_template("error.html", code=500,
                               message="Something went wrong on our end."), 500


def _bootstrap_admin(app: Flask) -> None:
    """Optionally create an initial admin from env vars on first run."""
    email = app.config.get("BOOTSTRAP_ADMIN_EMAIL")
    password = app.config.get("BOOTSTRAP_ADMIN_PASSWORD")
    if not email or not password:
        return
    email = email.strip().lower()
    if db.get_user_by_email(email) is not None:
        return
    db.create_user(
        email=email,
        display_name="Administrator",
        password_hash=hash_password(password),
        tier="premium",
        is_admin=1,
    )
    app.logger.info("Bootstrapped admin account: %s", email)


app = create_app()


if __name__ == "__main__":
    # debug=False so tracebacks are never exposed to clients.
    port = int(os.environ.get("PORT", "5072"))
    app.run(host="127.0.0.1", port=port, debug=False)
