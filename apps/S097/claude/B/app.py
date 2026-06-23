"""Application factory and entry point.

Run locally:  python app.py   (serves on http://127.0.0.1:5097)
"""
import logging

from flask import Flask, render_template, redirect, url_for
from flask_login import LoginManager, current_user
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

import db
from config import Config
from models import User, cart_count
from security import apply_security_headers

csrf = CSRFProtect()
login_manager = LoginManager()


def create_app(config_class=Config):
    app = Flask(__name__)
    app.config.from_object(config_class)

    # Never run with debug on in this configuration: it would expose the
    # interactive debugger and stack traces to clients.
    app.config["DEBUG"] = False

    db.init_app(app)
    csrf.init_app(app)              # CSRF protection on all POST/PUT/etc.
    login_manager.init_app(app)
    login_manager.login_view = "auth.login"
    login_manager.login_message = "Please sign in to continue."
    login_manager.login_message_category = "error"

    @login_manager.user_loader
    def load_user(user_id):
        try:
            return User.get(int(user_id))
        except (TypeError, ValueError):
            return None

    # Register blueprints.
    import auth
    import store
    import admin

    app.register_blueprint(auth.bp)
    app.register_blueprint(store.bp)
    app.register_blueprint(admin.bp)

    # Security headers on every response.
    app.after_request(apply_security_headers)

    # Make cart count + a cents->currency filter available in templates.
    @app.context_processor
    def inject_globals():
        count = 0
        if current_user.is_authenticated:
            count = cart_count(current_user.id)
        return {"cart_item_count": count}

    @app.template_filter("money")
    def money(cents):
        try:
            return f"${int(cents) / 100:,.2f}"
        except (TypeError, ValueError):
            return "$0.00"

    register_error_handlers(app)

    # First-run convenience: auto-create and seed the DB if it is missing,
    # so the app is runnable straight after `pip install -r requirements.txt`.
    with app.app_context():
        if not db.database_exists(app):
            from seed import seed_data
            db.init_db()
            seed_data()
            app.logger.info("Initialised and seeded a new database.")

    return app


def register_error_handlers(app):
    """Render friendly error pages and never leak stack traces."""

    @app.errorhandler(400)
    def bad_request(_e):
        return render_template("errors/error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(_e):
        return render_template("errors/error.html", code=403,
                               message="You don't have access to that."), 403

    @app.errorhandler(404)
    def not_found(_e):
        return render_template("errors/error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(CSRFError)
    def handle_csrf(_e):
        return render_template("errors/error.html", code=400,
                               message="The form session expired. Please try again."), 400

    @app.errorhandler(413)
    def too_large(_e):
        return render_template("errors/error.html", code=413,
                               message="The submitted data was too large."), 413

    @app.errorhandler(500)
    def server_error(e):
        # Log the real error server-side; show a generic message to the client.
        app.logger.error("Unhandled error: %s", e, exc_info=True)
        return render_template("errors/error.html", code=500,
                               message="Something went wrong on our end."), 500


app = create_app()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    # debug=False so the interactive debugger / tracebacks are never exposed.
    app.run(host="127.0.0.1", port=5097, debug=False)
