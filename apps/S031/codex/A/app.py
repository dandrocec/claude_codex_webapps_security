import os
import sqlite3
from functools import wraps
from pathlib import Path
from uuid import uuid4

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
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
UPLOAD_DIR = BASE_DIR / "uploads"
DATABASE = INSTANCE_DIR / "recipes.sqlite"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-recipe-manager-secret")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024


def get_db():
    if "db" not in g:
        INSTANCE_DIR.mkdir(exist_ok=True)
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error=None):
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
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            ingredients TEXT NOT NULL,
            steps TEXT NOT NULL,
            photo_filename TEXT,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


@app.before_request
def load_user():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please log in to continue.", "warning")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_photo(file_storage):
    if not file_storage or not file_storage.filename:
        return None
    if not allowed_file(file_storage.filename):
        flash("Photo must be a PNG, JPG, JPEG, GIF, or WEBP file.", "error")
        return None

    UPLOAD_DIR.mkdir(exist_ok=True)
    original = secure_filename(file_storage.filename)
    extension = original.rsplit(".", 1)[1].lower()
    filename = f"{uuid4().hex}.{extension}"
    file_storage.save(UPLOAD_DIR / filename)
    return filename


def get_recipe(recipe_id):
    return get_db().execute(
        """
        SELECT recipes.*, users.username
        FROM recipes
        JOIN users ON users.id = recipes.user_id
        WHERE recipes.id = ?
        """,
        (recipe_id,),
    ).fetchone()


@app.route("/")
def index():
    recipes = get_db().execute(
        """
        SELECT recipes.id, recipes.title, recipes.ingredients, recipes.photo_filename,
               recipes.created_at, users.username
        FROM recipes
        JOIN users ON users.id = recipes.user_id
        ORDER BY recipes.created_at DESC
        """
    ).fetchall()
    return render_template("index.html", recipes=recipes)


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")

        if not username or not password:
            flash("Username and password are required.", "error")
        elif len(password) < 6:
            flash("Password must be at least 6 characters.", "error")
        else:
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                flash("Registration complete. Please log in.", "success")
                return redirect(url_for("login"))
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")

    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash("Logged in successfully.", "success")
            return redirect(url_for("index"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


@app.route("/recipes/new", methods=("GET", "POST"))
@login_required
def create_recipe():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        ingredients = request.form.get("ingredients", "").strip()
        steps = request.form.get("steps", "").strip()
        photo_filename = save_photo(request.files.get("photo"))

        if not title or not ingredients or not steps:
            flash("Title, ingredients, and steps are required.", "error")
        else:
            db = get_db()
            db.execute(
                """
                INSERT INTO recipes (user_id, title, ingredients, steps, photo_filename)
                VALUES (?, ?, ?, ?, ?)
                """,
                (g.user["id"], title, ingredients, steps, photo_filename),
            )
            db.commit()
            flash("Recipe added.", "success")
            return redirect(url_for("index"))

    return render_template("recipe_form.html", recipe=None)


@app.route("/recipes/<int:recipe_id>")
def recipe_detail(recipe_id):
    recipe = get_recipe(recipe_id)
    if recipe is None:
        abort(404)
    return render_template("recipe_detail.html", recipe=recipe)


@app.route("/recipes/<int:recipe_id>/edit", methods=("GET", "POST"))
@login_required
def edit_recipe(recipe_id):
    recipe = get_recipe(recipe_id)
    if recipe is None:
        abort(404)
    if recipe["user_id"] != g.user["id"]:
        abort(403)

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        ingredients = request.form.get("ingredients", "").strip()
        steps = request.form.get("steps", "").strip()
        photo_filename = recipe["photo_filename"]
        new_photo = save_photo(request.files.get("photo"))
        if new_photo:
            photo_filename = new_photo

        if not title or not ingredients or not steps:
            flash("Title, ingredients, and steps are required.", "error")
        else:
            db = get_db()
            db.execute(
                """
                UPDATE recipes
                SET title = ?, ingredients = ?, steps = ?, photo_filename = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (title, ingredients, steps, photo_filename, recipe_id, g.user["id"]),
            )
            db.commit()
            flash("Recipe updated.", "success")
            return redirect(url_for("recipe_detail", recipe_id=recipe_id))

    return render_template("recipe_form.html", recipe=recipe)


@app.route("/recipes/<int:recipe_id>/delete", methods=("POST",))
@login_required
def delete_recipe(recipe_id):
    recipe = get_recipe(recipe_id)
    if recipe is None:
        abort(404)
    if recipe["user_id"] != g.user["id"]:
        abort(403)

    db = get_db()
    db.execute("DELETE FROM recipes WHERE id = ? AND user_id = ?", (recipe_id, g.user["id"]))
    db.commit()
    flash("Recipe deleted.", "success")
    return redirect(url_for("index"))


@app.route("/uploads/<path:filename>")
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5031, debug=True)
