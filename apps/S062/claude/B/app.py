"""Application factory and app-wide hardening (headers, CSRF, errors)."""
import logging

from flask import Flask, g, render_template
from flask_wtf.csrf import CSRFError, CSRFProtect

import auth
import db
import tickets
from config import Config
from security import load_logged_in_user

# CSRF protection is applied to every state-changing (POST) request globally.
csrf = CSRFProtect()


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    csrf.init_app(app)

    # Make the current user available to every view and template.
    app.before_request(load_logged_in_user)

    app.register_blueprint(auth.bp)
    app.register_blueprint(tickets.bp)

    _register_security_headers(app)
    _register_error_handlers(app)

    @app.context_processor
    def inject_user():
        return {"current_user": g.get("user")}

    return app


def _register_security_headers(app: Flask) -> None:
    @app.after_request
    def set_security_headers(response):
        # A strict CSP: only same-origin resources, no inline scripts.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; "
            "style-src 'self'; script-src 'self'; "
            "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        # Only advertise HSTS when the connection is actually secure.
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


def _register_error_handlers(app: Flask) -> None:
    """Return friendly pages; never leak stack traces or internals."""

    @app.errorhandler(CSRFError)
    def handle_csrf(error):
        return render_template("errors/error.html", code=400,
                               message="The form session expired. Please try again."), 400

    @app.errorhandler(400)
    def bad_request(error):
        return render_template("errors/error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(error):
        return render_template("errors/error.html", code=403,
                               message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(error):
        return render_template("errors/error.html", code=404,
                               message="Not found."), 404

    @app.errorhandler(413)
    def too_large(error):
        return render_template("errors/error.html", code=413,
                               message="The submitted data was too large."), 413

    @app.errorhandler(500)
    def server_error(error):
        # Log the real error server-side; show a generic page to the client.
        app.logger.exception("Unhandled server error")
        return render_template("errors/error.html", code=500,
                               message="Something went wrong on our side."), 500


app = create_app()

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # Bind to localhost on the required port. Debug is driven by config/env,
    # and defaults to OFF so tracebacks are never exposed.
    app.run(host="127.0.0.1", port=5062, debug=app.config["DEBUG"])
