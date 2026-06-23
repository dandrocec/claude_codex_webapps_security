"""Application factory and wiring.

Run locally:
    flask --app app init-db      # create tables
    flask --app app seed         # add demo products + admin user
    flask --app app run --port 5089
"""
import os
import logging
import secrets

import click
from dotenv import load_dotenv
from flask import Flask, render_template
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError
from flask_login import LoginManager

load_dotenv()  # read .env before Config is evaluated

from config import Config            # noqa: E402
import db                            # noqa: E402
from models import get_user_by_id, get_user_by_email, create_user  # noqa: E402

logging.basicConfig(level=logging.INFO)

csrf = CSRFProtect()
login_manager = LoginManager()
login_manager.login_view = "auth.login"
login_manager.login_message_category = "error"


def create_app(config_object: type = Config) -> Flask:
    app = Flask(__name__)
    app.config.from_object(config_object)

    db.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)

    from blueprints.auth import bp as auth_bp
    from blueprints.main import bp as main_bp
    from blueprints.admin import bp as admin_bp
    from blueprints.sandbox import bp as sandbox_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(main_bp)
    app.register_blueprint(admin_bp)
    app.register_blueprint(sandbox_bp)

    # The webhook is authenticated by its HMAC signature, not a session, so it
    # must be exempt from CSRF (the caller is the payment provider, not a
    # browser form). Only that single view is exempted; every other POST stays
    # protected by Flask-WTF.
    csrf.exempt(app.view_functions["main.webhook"])

    _register_user_loader()
    _register_security_headers(app)
    _register_error_handlers(app)
    _register_cli(app)
    _register_context(app)
    return app


def _register_user_loader():
    @login_manager.user_loader
    def load_user(user_id):
        try:
            return get_user_by_id(int(user_id))
        except (TypeError, ValueError):
            return None


def _register_security_headers(app):
    @app.after_request
    def set_headers(resp):
        # Context-aware output encoding is handled by Jinja2 autoescaping; CSP
        # is defence-in-depth against XSS and clickjacking.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'self'; img-src 'self' data:; "
            "style-src 'self'; script-src 'self'; "
            "form-action 'self'; frame-ancestors 'none'; base-uri 'self'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


def _register_error_handlers(app):
    # Friendly pages only; internal details are logged, never sent to clients.
    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(CSRFError)
    def csrf_error(_e):
        return render_template("error.html", code=400,
                               message="The form expired or was invalid. "
                                       "Please try again."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("error.html", code=403,
                               message="You don't have access to that."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(500)
    def server_error(_e):
        return render_template("error.html", code=500,
                               message="Something went wrong."), 500

    @app.errorhandler(Exception)
    def unhandled(e):
        app.logger.exception("Unhandled exception: %s", e)
        return render_template("error.html", code=500,
                               message="Something went wrong."), 500


def _register_context(app):
    from forms import CSRFOnlyForm

    @app.context_processor
    def inject_globals():
        # `cents` filter renders integer cents as currency safely.
        return {"logout_form": CSRFOnlyForm()}

    @app.template_filter("money")
    def money(cents):
        return f"${cents / 100:,.2f}"


def _register_cli(app):
    @app.cli.command("seed")
    def seed():
        """Insert demo products and an admin user."""
        from db import get_db, init_db

        with app.app_context():
            init_db()
            database = get_db()
            products = [
                ("Aurora Desk Lamp", "Warm dimmable LED lamp with USB-C.", 4599, 25),
                ("Nimbus Wireless Mouse", "Silent-click ergonomic mouse.", 2999, 60),
                ("Terra Notebook", "A5 recycled-paper dotted notebook.", 1250, 200),
                ("Cobalt Water Bottle", "750ml vacuum-insulated steel bottle.", 2199, 80),
                ("Halcyon Headphones", "Over-ear noise-cancelling headphones.", 12900, 15),
            ]
            database.executemany(
                "INSERT INTO products (name, description, price_cents, stock) "
                "VALUES (?, ?, ?, ?)",
                products,
            )
            database.commit()

            admin_email = (os.environ.get("ADMIN_EMAIL") or "admin@example.com").lower()
            admin_pw = os.environ.get("ADMIN_PASSWORD")
            generated = False
            if not admin_pw:
                admin_pw = secrets.token_urlsafe(16)
                generated = True
            if get_user_by_email(admin_email) is None:
                create_user(admin_email, admin_pw, is_admin=True)
            click.echo(f"Seeded {len(products)} products.")
            click.echo(f"Admin user: {admin_email}")
            if generated:
                click.echo(f"Generated admin password (shown once): {admin_pw}")


# Module-level app for `flask --app app` and WSGI servers.
app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5089, debug=app.config["DEBUG"])
