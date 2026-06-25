import os
import re
import secrets
import sqlite3
from pathlib import Path
from uuid import uuid4

import bleach
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    send_from_directory,
    session,
    url_for,
)
from flask_wtf import CSRFProtect
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
ALLOWED_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}
MAX_TITLE_LENGTH = 120
MAX_TEXT_LENGTH = 5000

password_hasher = PasswordHasher()
csrf = CSRFProtect()


def create_app():
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_urlsafe(32),
        DATABASE=os.environ.get("DATABASE_PATH", str(BASE_DIR / "recipes.sqlite3")),
        UPLOAD_FOLDER=str(UPLOAD_DIR),
        MAX_CONTENT_LENGTH=3 * 1024 * 1024,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        == "true",
        WTF_CSRF_SSL_STRICT=False,
    )
    csrf.init_app(app)
    app.teardown_appcontext(close_db)
    UPLOAD_DIR.mkdir(exist_ok=True)

    @app.before_request
    def load_current_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = query_one(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            )

    @app.after_request
    def add_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "img-src 'self' data:; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        return response

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", title="Bad request", message="The request was invalid."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", title="Forbidden", message="You do not have access to this resource."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", title="Not found", message="The requested page was not found."), 404

    @app.errorhandler(413)
    def too_large(_error):
        return render_template("error.html", title="File too large", message="Photos must be 3 MB or smaller."), 413

    @app.errorhandler(500)
    def internal_error(_error):
        return render_template("error.html", title="Server error", message="An unexpected error occurred."), 500

    @app.route("/")
    def index():
        recipes = query_all(
            """
            SELECT recipes.id, recipes.title, recipes.ingredients, recipes.photo_filename,
                   recipes.created_at, users.username
            FROM recipes
            JOIN users ON users.id = recipes.user_id
            ORDER BY recipes.created_at DESC
            """
        )
        return render_template("index.html", recipes=recipes)

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            username = normalise_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            confirm = request.form.get("confirm_password", "")

            errors = validate_registration(username, password, confirm)
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("register.html", username=username), 400

            password_hash = password_hasher.hash(password)
            try:
                execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, password_hash),
                )
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
                return render_template("register.html", username=username), 400

            flash("Account created. Please log in.", "success")
            return redirect(url_for("login"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            username = normalise_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = query_one(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            )
            if not user or not verify_password(user["password_hash"], password):
                flash("Invalid username or password.", "error")
                return render_template("login.html", username=username), 400

            session.clear()
            session["user_id"] = user["id"]
            flash("Logged in successfully.", "success")
            return redirect(url_for("index"))

        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        flash("Logged out.", "success")
        return redirect(url_for("index"))

    @app.route("/recipes/new", methods=["GET", "POST"])
    def create_recipe():
        require_login()
        if request.method == "POST":
            form_data, errors = validated_recipe_form(request.form)
            photo_filename, photo_error = save_photo(request.files.get("photo"))
            if photo_error:
                errors.append(photo_error)
            if errors:
                for error in errors:
                    flash(error, "error")
                return render_template("recipe_form.html", recipe=form_data, action="Create"), 400

            recipe_id = execute(
                """
                INSERT INTO recipes (user_id, title, ingredients, steps, photo_filename)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    g.user["id"],
                    form_data["title"],
                    form_data["ingredients"],
                    form_data["steps"],
                    photo_filename,
                ),
            )
            flash("Recipe created.", "success")
            return redirect(url_for("recipe_detail", recipe_id=recipe_id))

        return render_template("recipe_form.html", recipe={}, action="Create")

    @app.route("/recipes/<int:recipe_id>")
    def recipe_detail(recipe_id):
        recipe = get_recipe_or_404(recipe_id)
        return render_template("recipe_detail.html", recipe=recipe)

    @app.route("/recipes/<int:recipe_id>/edit", methods=["GET", "POST"])
    def edit_recipe(recipe_id):
        require_login()
        recipe = get_recipe_or_404(recipe_id)
        ensure_owner(recipe)

        if request.method == "POST":
            form_data, errors = validated_recipe_form(request.form)
            photo_filename = recipe["photo_filename"]
            uploaded_filename, photo_error = save_photo(request.files.get("photo"))
            if photo_error:
                errors.append(photo_error)
            if uploaded_filename:
                photo_filename = uploaded_filename
            if errors:
                for error in errors:
                    flash(error, "error")
                form_data["id"] = recipe_id
                form_data["photo_filename"] = recipe["photo_filename"]
                return render_template("recipe_form.html", recipe=form_data, action="Edit"), 400

            execute(
                """
                UPDATE recipes
                SET title = ?, ingredients = ?, steps = ?, photo_filename = ?
                WHERE id = ? AND user_id = ?
                """,
                (
                    form_data["title"],
                    form_data["ingredients"],
                    form_data["steps"],
                    photo_filename,
                    recipe_id,
                    g.user["id"],
                ),
            )
            flash("Recipe updated.", "success")
            return redirect(url_for("recipe_detail", recipe_id=recipe_id))

        return render_template("recipe_form.html", recipe=recipe, action="Edit")

    @app.route("/recipes/<int:recipe_id>/delete", methods=["POST"])
    def delete_recipe(recipe_id):
        require_login()
        recipe = get_recipe_or_404(recipe_id)
        ensure_owner(recipe)
        execute("DELETE FROM recipes WHERE id = ? AND user_id = ?", (recipe_id, g.user["id"]))
        flash("Recipe deleted.", "success")
        return redirect(url_for("index"))

    @app.route("/uploads/<path:filename>")
    def uploaded_file(filename):
        safe_name = secure_filename(filename)
        if safe_name != filename:
            abort(404)
        return send_from_directory(app.config["UPLOAD_FOLDER"], safe_name)

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Database initialized.")

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        db_path = Path(current_app_config("DATABASE"))
        db_path.parent.mkdir(parents=True, exist_ok=True)
        g.db = sqlite3.connect(db_path)
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            steps TEXT NOT NULL,
            photo_filename TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    cursor = db.execute(sql, params)
    db.commit()
    return cursor.lastrowid


def normalise_username(value):
    return value.strip().lower()


def clean_text(value, max_length):
    value = bleach.clean(value or "", tags=[], attributes={}, strip=True).strip()
    value = re.sub(r"\r\n?", "\n", value)
    value = re.sub(r"\n{4,}", "\n\n\n", value)
    return value[:max_length]


def validate_registration(username, password, confirm):
    errors = []
    if not re.fullmatch(r"[a-z0-9_]{3,30}", username):
        errors.append("Username must be 3-30 characters and use only lowercase letters, numbers, and underscores.")
    if len(password) < 12:
        errors.append("Password must be at least 12 characters.")
    if password != confirm:
        errors.append("Passwords do not match.")
    return errors


def verify_password(password_hash, password):
    try:
        return password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def validated_recipe_form(form):
    title = clean_text(form.get("title", ""), MAX_TITLE_LENGTH)
    ingredients = clean_text(form.get("ingredients", ""), MAX_TEXT_LENGTH)
    steps = clean_text(form.get("steps", ""), MAX_TEXT_LENGTH)
    errors = []
    if not title:
        errors.append("Title is required.")
    if not ingredients:
        errors.append("Ingredients are required.")
    if not steps:
        errors.append("Steps are required.")
    return {"title": title, "ingredients": ingredients, "steps": steps}, errors


def save_photo(file_storage):
    if not file_storage or not file_storage.filename:
        return None, None

    original = secure_filename(file_storage.filename)
    ext = original.rsplit(".", 1)[-1].lower() if "." in original else ""
    if ext not in ALLOWED_EXTENSIONS:
        return None, "Photos must be JPG, PNG, or WebP files."

    filename = f"{uuid4().hex}.{ext}"
    destination = UPLOAD_DIR / filename
    try:
        with Image.open(file_storage.stream) as image:
            image.verify()
        file_storage.stream.seek(0)
        with Image.open(file_storage.stream) as image:
            image.thumbnail((1600, 1600))
            image.save(destination)
    except (UnidentifiedImageError, OSError):
        return None, "The uploaded photo is not a valid image."

    return filename, None


def require_login():
    if g.user is None:
        flash("Please log in first.", "error")
        abort(403)


def get_recipe_or_404(recipe_id):
    recipe = query_one(
        """
        SELECT recipes.id, recipes.user_id, recipes.title, recipes.ingredients,
               recipes.steps, recipes.photo_filename, recipes.created_at, users.username
        FROM recipes
        JOIN users ON users.id = recipes.user_id
        WHERE recipes.id = ?
        """,
        (recipe_id,),
    )
    if recipe is None:
        abort(404)
    return recipe


def ensure_owner(recipe):
    if recipe["user_id"] != g.user["id"]:
        abort(403)


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5031, debug=False)
