"""Admin dashboard — application factory, routes and security middleware."""
import os
import secrets

import click
from dotenv import load_dotenv
from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from flask_wtf import CSRFProtect
from flask_wtf.csrf import CSRFError

from config import Config
from db import (
    close_db,
    create_user,
    get_user_by_id,
    get_user_by_username,
    init_db,
    list_users,
    set_active,
    stats,
    touch_last_login,
    update_password,
    update_user,
)
from forms import ActionForm, LoginForm, UserCreateForm, UserEditForm
from security import current_user, hash_password, login_required, verify_password

load_dotenv()

csrf = CSRFProtect()


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    Config.validate()

    csrf.init_app(app)
    app.teardown_appcontext(close_db)

    register_security(app)
    register_errors(app)
    register_routes(app)
    register_cli(app)

    # Make the current user and a CSRF-carrying form available to templates.
    @app.context_processor
    def inject_globals():
        return {"current_user": current_user()}

    return app


# --------------------------------------------------------------------------
# Security middleware
# --------------------------------------------------------------------------
def register_security(app: Flask) -> None:
    @app.after_request
    def set_security_headers(resp):
        # Context-aware output encoding is handled by Jinja autoescaping; the
        # CSP below is a strong second line of defence against XSS. Inline
        # styles are allowed (the app ships a small inline stylesheet); no
        # inline or remote scripts are permitted.
        resp.headers["Content-Security-Policy"] = (
            "default-src 'none'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "form-action 'self'; "
            "base-uri 'none'; "
            "frame-ancestors 'none'"
        )
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "no-referrer"
        resp.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        resp.headers["Cache-Control"] = "no-store"
        if app.config.get("SESSION_COOKIE_SECURE"):
            resp.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return resp


# --------------------------------------------------------------------------
# Error handling — never leak internals to clients
# --------------------------------------------------------------------------
def register_errors(app: Flask) -> None:
    @app.errorhandler(CSRFError)
    def handle_csrf(e):
        return render_template("error.html", code=400,
                               message="The form session expired. Please try again."), 400

    @app.errorhandler(400)
    def bad_request(e):
        return render_template("error.html", code=400,
                               message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403,
                               message="You are not allowed to do that."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404,
                               message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(e):
        return render_template("error.html", code=413,
                               message="The request was too large."), 413

    @app.errorhandler(500)
    def server_error(e):
        # The real exception is logged by Flask; the client sees a generic page.
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500,
                               message="Something went wrong on our end."), 500


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------
def register_routes(app: Flask) -> None:

    @app.route("/")
    def index():
        if current_user():
            return redirect(url_for("dashboard"))
        return redirect(url_for("login"))

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user():
            return redirect(url_for("dashboard"))

        form = LoginForm()
        if form.validate_on_submit():
            user = get_user_by_username(form.username.data.strip())
            # Always run a verification to keep timing roughly constant and
            # return one generic message regardless of which check failed.
            stored_hash = user["password_hash"] if user else (
                "$2b$12$" + "x" * 53
            )
            ok = verify_password(form.password.data, stored_hash)
            if user and ok and user["is_admin"] and user["is_active"]:
                # Prevent session fixation: new session on privilege change.
                session.clear()
                session["user_id"] = user["id"]
                session.permanent = True
                touch_last_login(user["id"])
                return redirect(url_for("dashboard"))
            flash("Invalid credentials.", "error")

        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("You have been signed out.", "success")
        return redirect(url_for("login"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        return render_template(
            "dashboard.html",
            users=list_users(),
            metrics=stats(),
            action_form=ActionForm(),
        )

    @app.route("/users/new", methods=["GET", "POST"])
    @login_required
    def user_new():
        form = UserCreateForm()
        if form.validate_on_submit():
            if get_user_by_username(form.username.data.strip()):
                form.username.errors.append("That username is already taken.")
            else:
                create_user(
                    username=form.username.data.strip(),
                    email=form.email.data.strip(),
                    password_hash=hash_password(form.password.data),
                    is_admin=form.is_admin.data,
                    is_active=form.is_active.data,
                )
                flash("User created.", "success")
                return redirect(url_for("dashboard"))
        return render_template("user_form.html", form=form, mode="create")

    @app.route("/users/<int:user_id>/edit", methods=["GET", "POST"])
    @login_required
    def user_edit(user_id):
        user = get_user_by_id(user_id)
        if user is None:
            abort(404)

        form = UserEditForm(data={
            "username": user["username"],
            "email": user["email"],
            "is_admin": bool(user["is_admin"]),
            "is_active": bool(user["is_active"]),
        })

        if form.validate_on_submit():
            me = current_user()
            # Guard rails: an admin must not lock themselves out or strip their
            # own admin rights — this also closes the self-targeting IDOR.
            demoting_self = user["id"] == me["id"] and (
                not form.is_admin.data or not form.is_active.data
            )
            if demoting_self:
                flash("You cannot deactivate or demote your own account.", "error")
                return render_template(
                    "user_form.html", form=form, mode="edit", target=user
                )

            clash = get_user_by_username(form.username.data.strip())
            if clash and clash["id"] != user["id"]:
                form.username.errors.append("That username is already taken.")
                return render_template(
                    "user_form.html", form=form, mode="edit", target=user
                )

            update_user(
                user_id=user["id"],
                username=form.username.data.strip(),
                email=form.email.data.strip(),
                is_admin=form.is_admin.data,
                is_active=form.is_active.data,
            )
            if form.password.data:
                update_password(user["id"], hash_password(form.password.data))
            flash("User updated.", "success")
            return redirect(url_for("dashboard"))

        return render_template(
            "user_form.html", form=form, mode="edit", target=user
        )

    @app.route("/users/<int:user_id>/deactivate", methods=["POST"])
    @login_required
    def user_deactivate(user_id):
        form = ActionForm()
        if not form.validate_on_submit():
            abort(400)
        user = get_user_by_id(user_id)
        if user is None:
            abort(404)
        if user["id"] == current_user()["id"]:
            flash("You cannot deactivate your own account.", "error")
            return redirect(url_for("dashboard"))
        set_active(user["id"], False)
        flash(f"User '{user['username']}' deactivated.", "success")
        return redirect(url_for("dashboard"))

    @app.route("/users/<int:user_id>/activate", methods=["POST"])
    @login_required
    def user_activate(user_id):
        form = ActionForm()
        if not form.validate_on_submit():
            abort(400)
        user = get_user_by_id(user_id)
        if user is None:
            abort(404)
        set_active(user["id"], True)
        flash(f"User '{user['username']}' reactivated.", "success")
        return redirect(url_for("dashboard"))


# --------------------------------------------------------------------------
# CLI helpers
# --------------------------------------------------------------------------
def register_cli(app: Flask) -> None:
    @app.cli.command("init-db")
    def init_db_cmd():
        """Create database tables."""
        init_db()
        click.echo("Initialised the database.")

    @app.cli.command("create-admin")
    @click.option("--username", required=True)
    @click.option("--email", required=True)
    @click.option("--password", required=True, hide_input=True,
                  prompt=True, confirmation_prompt=True)
    def create_admin_cmd(username, email, password):
        """Create (or report) an initial administrator account."""
        init_db()
        if get_user_by_username(username):
            click.echo(f"User '{username}' already exists.")
            return
        if len(password) < 12:
            click.echo("Password must be at least 12 characters.")
            return
        create_user(
            username=username,
            email=email,
            password_hash=hash_password(password),
            is_admin=True,
            is_active=True,
        )
        click.echo(f"Admin '{username}' created.")


app = create_app()


if __name__ == "__main__":
    # Bind to localhost only; debug is OFF so no interactive debugger/stack
    # traces are ever exposed.
    port = int(os.environ.get("PORT", "5086"))
    app.run(host="127.0.0.1", port=port, debug=False)
