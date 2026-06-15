"""Flask Recipe Manager.

A small recipe-sharing app with registration, login, per-user CRUD on
recipes, optional photo uploads, and a public browse view.

Security posture (OWASP Top 10):
  * A01 Broken Access Control ... ownership checks on every edit/delete (no IDOR)
  * A02 Cryptographic Failures . Argon2id password hashing; Secure/HttpOnly cookies
  * A03 Injection ............... parameterised SQL everywhere; Jinja autoescaping
  * A05 Misconfiguration ........ security headers; secrets from env; no debug in prod
  * A07 Auth Failures ........... Flask-Login sessions; generic auth errors
  * CSRF ........................ Flask-WTF tokens on all state-changing POSTs
"""
import os
import secrets
import uuid

from dotenv import load_dotenv

# Load environment variables from a local .env file (if present) before the
# configuration object reads them. Real env vars always take precedence.
load_dotenv()

from flask import (
    Flask,
    render_template,
    redirect,
    url_for,
    request,
    flash,
    abort,
)
from flask_login import (
    LoginManager,
    UserMixin,
    login_user,
    logout_user,
    login_required,
    current_user,
)
from flask_wtf.csrf import CSRFProtect
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHashError
from werkzeug.utils import secure_filename
from PIL import Image, UnidentifiedImageError

from config import Config
import db as database
from forms import RegisterForm, LoginForm, RecipeForm

password_hasher = PasswordHasher()
login_manager = LoginManager()
csrf = CSRFProtect()


# --------------------------------------------------------------------------- #
# User model (thin wrapper over the users table for Flask-Login)
# --------------------------------------------------------------------------- #
class User(UserMixin):
    def __init__(self, row):
        self.id = row["id"]
        self.username = row["username"]
        self.email = row["email"]
        self.password_hash = row["password_hash"]


@login_manager.user_loader
def load_user(user_id):
    db = database.get_db()
    row = db.execute(
        "SELECT id, username, email, password_hash FROM users WHERE id = ?",
        (user_id,),
    ).fetchone()
    return User(row) if row else None


# --------------------------------------------------------------------------- #
# App factory
# --------------------------------------------------------------------------- #
def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    # Fail fast rather than run with a weak/missing signing key.
    if not app.config.get("SECRET_KEY"):
        if app.config.get("ENV") == "production" or os.environ.get("FLASK_ENV") == "production":
            raise RuntimeError("SECRET_KEY environment variable must be set in production.")
        # Dev convenience: ephemeral key (sessions reset on restart).
        app.config["SECRET_KEY"] = secrets.token_hex(32)
        app.logger.warning("SECRET_KEY not set; using an ephemeral development key.")

    os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)
    os.makedirs(os.path.dirname(app.config["DATABASE"]), exist_ok=True)

    database.init_app(app)
    csrf.init_app(app)
    login_manager.init_app(app)
    login_manager.login_view = "login"
    login_manager.login_message_category = "error"

    register_security_headers(app)
    register_error_handlers(app)
    register_routes(app)
    return app


# --------------------------------------------------------------------------- #
# Security headers (A05)
# --------------------------------------------------------------------------- #
def register_security_headers(app):
    @app.after_request
    def set_headers(response):
        # Strict CSP: only same-origin assets; no inline JS. Our pages use an
        # external stylesheet only, so this does not break anything.
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self'; "
            "script-src 'self'; object-src 'none'; base-uri 'self'; "
            "form-action 'self'; frame-ancestors 'none'",
        )
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault(
            "Permissions-Policy", "geolocation=(), microphone=(), camera=()"
        )
        if app.config.get("SESSION_COOKIE_SECURE"):
            response.headers.setdefault(
                "Strict-Transport-Security",
                "max-age=31536000; includeSubDomains",
            )
        return response


# --------------------------------------------------------------------------- #
# Error handlers — never leak stack traces / internals to clients (A05/A09)
# --------------------------------------------------------------------------- #
def register_error_handlers(app):
    @app.errorhandler(400)
    def bad_request(e):
        return render_template("error.html", code=400, message="Bad request."), 400

    @app.errorhandler(403)
    def forbidden(e):
        return render_template("error.html", code=403, message="You do not have access to that."), 403

    @app.errorhandler(404)
    def not_found(e):
        return render_template("error.html", code=404, message="Page not found."), 404

    @app.errorhandler(413)
    def too_large(e):
        return render_template("error.html", code=413, message="File too large (max 4 MB)."), 413

    @app.errorhandler(500)
    def server_error(e):
        app.logger.exception("Unhandled server error")
        return render_template("error.html", code=500, message="Something went wrong."), 500


# --------------------------------------------------------------------------- #
# Photo handling — validate the file is really an image, re-save it under a
# random name, and strip any embedded payload by re-encoding via Pillow.
# --------------------------------------------------------------------------- #
def save_photo(file_storage, app):
    if not file_storage or not file_storage.filename:
        return None

    ext = file_storage.filename.rsplit(".", 1)[-1].lower() if "." in file_storage.filename else ""
    if ext not in app.config["ALLOWED_IMAGE_EXTENSIONS"]:
        raise ValueError("Unsupported image type.")

    try:
        image = Image.open(file_storage.stream)
        image.verify()  # detect truncated / non-image files
        file_storage.stream.seek(0)
        image = Image.open(file_storage.stream)
        image = image.convert("RGB") if ext in {"jpg", "jpeg"} else image.convert("RGBA") if ext == "png" else image
    except (UnidentifiedImageError, OSError):
        raise ValueError("That file is not a valid image.")

    safe_name = f"{uuid.uuid4().hex}.{ 'jpg' if ext == 'jpeg' else ext }"
    # secure_filename is belt-and-suspenders; the name is already random.
    safe_name = secure_filename(safe_name)
    dest = os.path.join(app.config["UPLOAD_FOLDER"], safe_name)

    save_format = {"jpg": "JPEG", "jpeg": "JPEG", "png": "PNG",
                   "gif": "GIF", "webp": "WEBP"}[ext]
    image.save(dest, format=save_format)
    return safe_name


def delete_photo(filename, app):
    if not filename:
        return
    path = os.path.join(app.config["UPLOAD_FOLDER"], os.path.basename(filename))
    try:
        if os.path.isfile(path):
            os.remove(path)
    except OSError:
        app.logger.warning("Could not remove photo %s", filename)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
def register_routes(app):

    @app.route("/")
    def index():
        db = database.get_db()
        recipes = db.execute(
            """SELECT r.id, r.title, r.photo, r.created_at, u.username
                 FROM recipes r JOIN users u ON u.id = r.user_id
             ORDER BY r.created_at DESC"""
        ).fetchall()
        return render_template("index.html", recipes=recipes)

    # ----------------------------- auth -------------------------------- #
    @app.route("/register", methods=["GET", "POST"])
    def register():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = RegisterForm()
        if form.validate_on_submit():
            db = database.get_db()
            username = form.username.data.strip()
            email = form.email.data.strip().lower()
            existing = db.execute(
                "SELECT 1 FROM users WHERE username = ? OR email = ?",
                (username, email),
            ).fetchone()
            if existing:
                # Generic message — do not reveal which field collided.
                flash("Could not create account with those details.", "error")
                return render_template("register.html", form=form)

            pw_hash = password_hasher.hash(form.password.data)
            db.execute(
                "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
                (username, email, pw_hash),
            )
            db.commit()
            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if current_user.is_authenticated:
            return redirect(url_for("index"))
        form = LoginForm()
        if form.validate_on_submit():
            db = database.get_db()
            row = db.execute(
                "SELECT id, username, email, password_hash FROM users WHERE username = ?",
                (form.username.data.strip(),),
            ).fetchone()

            authenticated = False
            if row is not None:
                try:
                    password_hasher.verify(row["password_hash"], form.password.data)
                    authenticated = True
                    # Transparent rehash if Argon2 parameters have changed.
                    if password_hasher.check_needs_rehash(row["password_hash"]):
                        new_hash = password_hasher.hash(form.password.data)
                        db.execute(
                            "UPDATE users SET password_hash = ? WHERE id = ?",
                            (new_hash, row["id"]),
                        )
                        db.commit()
                except (VerifyMismatchError, InvalidHashError):
                    authenticated = False
            else:
                # Equalise timing against username enumeration.
                password_hasher.hash(form.password.data)

            if authenticated:
                login_user(User(row))
                flash("Welcome back!", "success")
                next_url = request.args.get("next")
                # Open-redirect guard: only allow local relative paths.
                if next_url and next_url.startswith("/") and not next_url.startswith("//"):
                    return redirect(next_url)
                return redirect(url_for("index"))

            flash("Invalid username or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        logout_user()
        flash("You have been logged out.", "success")
        return redirect(url_for("index"))

    # ---------------------------- recipes ------------------------------ #
    @app.route("/recipes/mine")
    @login_required
    def my_recipes():
        db = database.get_db()
        recipes = db.execute(
            "SELECT id, title, photo, created_at FROM recipes "
            "WHERE user_id = ? ORDER BY created_at DESC",
            (current_user.id,),
        ).fetchall()
        return render_template("my_recipes.html", recipes=recipes)

    @app.route("/recipes/<int:recipe_id>")
    def view_recipe(recipe_id):
        db = database.get_db()
        recipe = db.execute(
            """SELECT r.*, u.username FROM recipes r
                 JOIN users u ON u.id = r.user_id
                WHERE r.id = ?""",
            (recipe_id,),
        ).fetchone()
        if recipe is None:
            abort(404)
        return render_template("view_recipe.html", recipe=recipe)

    @app.route("/recipes/new", methods=["GET", "POST"])
    @login_required
    def new_recipe():
        form = RecipeForm()
        if form.validate_on_submit():
            try:
                photo_name = save_photo(form.photo.data, app)
            except ValueError as exc:
                flash(str(exc), "error")
                return render_template("recipe_form.html", form=form, mode="new")

            db = database.get_db()
            db.execute(
                """INSERT INTO recipes (user_id, title, ingredients, steps, photo)
                   VALUES (?, ?, ?, ?, ?)""",
                (
                    current_user.id,
                    form.title.data.strip(),
                    form.ingredients.data.strip(),
                    form.steps.data.strip(),
                    photo_name,
                ),
            )
            db.commit()
            flash("Recipe added.", "success")
            return redirect(url_for("my_recipes"))
        return render_template("recipe_form.html", form=form, mode="new")

    def _owned_recipe_or_403(recipe_id):
        """Fetch a recipe and enforce ownership (prevents IDOR / A01)."""
        db = database.get_db()
        recipe = db.execute(
            "SELECT * FROM recipes WHERE id = ?", (recipe_id,)
        ).fetchone()
        if recipe is None:
            abort(404)
        if recipe["user_id"] != current_user.id:
            abort(403)
        return recipe

    @app.route("/recipes/<int:recipe_id>/edit", methods=["GET", "POST"])
    @login_required
    def edit_recipe(recipe_id):
        recipe = _owned_recipe_or_403(recipe_id)
        form = RecipeForm(data={
            "title": recipe["title"],
            "ingredients": recipe["ingredients"],
            "steps": recipe["steps"],
        })
        if form.validate_on_submit():
            photo_name = recipe["photo"]
            if form.photo.data and form.photo.data.filename:
                try:
                    new_photo = save_photo(form.photo.data, app)
                except ValueError as exc:
                    flash(str(exc), "error")
                    return render_template("recipe_form.html", form=form, mode="edit", recipe=recipe)
                delete_photo(recipe["photo"], app)
                photo_name = new_photo

            db = database.get_db()
            db.execute(
                """UPDATE recipes
                      SET title = ?, ingredients = ?, steps = ?, photo = ?,
                          updated_at = datetime('now')
                    WHERE id = ? AND user_id = ?""",
                (
                    form.title.data.strip(),
                    form.ingredients.data.strip(),
                    form.steps.data.strip(),
                    photo_name,
                    recipe_id,
                    current_user.id,
                ),
            )
            db.commit()
            flash("Recipe updated.", "success")
            return redirect(url_for("view_recipe", recipe_id=recipe_id))
        return render_template("recipe_form.html", form=form, mode="edit", recipe=recipe)

    @app.route("/recipes/<int:recipe_id>/delete", methods=["POST"])
    @login_required
    def delete_recipe(recipe_id):
        recipe = _owned_recipe_or_403(recipe_id)
        db = database.get_db()
        db.execute(
            "DELETE FROM recipes WHERE id = ? AND user_id = ?",
            (recipe_id, current_user.id),
        )
        db.commit()
        delete_photo(recipe["photo"], app)
        flash("Recipe deleted.", "success")
        return redirect(url_for("my_recipes"))


app = create_app()

if __name__ == "__main__":
    # Bind to port 5031 as documented in the README. Debug is controlled by
    # FLASK_DEBUG and defaults OFF so stack traces are never shown to clients.
    debug = os.environ.get("FLASK_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}
    app.run(host="127.0.0.1", port=5031, debug=debug)
