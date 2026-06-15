import os
import uuid

from flask import (
    Flask,
    render_template,
    request,
    redirect,
    url_for,
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
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5 MB

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
    BASE_DIR, "recipes.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

db = SQLAlchemy(app)
login_manager = LoginManager(app)
login_manager.login_view = "login"
login_manager.login_message_category = "error"


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    recipes = db.relationship(
        "Recipe", backref="author", lazy=True, cascade="all, delete-orphan"
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Recipe(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    ingredients = db.Column(db.Text, nullable=False)
    steps = db.Column(db.Text, nullable=False)
    photo = db.Column(db.String(255), nullable=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_photo(file_storage):
    """Save an uploaded photo and return its stored filename, or None."""
    if not file_storage or file_storage.filename == "":
        return None
    if not allowed_file(file_storage.filename):
        flash("Unsupported image type. Use png, jpg, jpeg, gif or webp.", "error")
        return None
    ext = file_storage.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    file_storage.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
    return filename


def delete_photo(filename):
    if not filename:
        return
    path = os.path.join(app.config["UPLOAD_FOLDER"], filename)
    if os.path.exists(path):
        os.remove(path)


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #
@app.route("/")
def index():
    recipes = Recipe.query.order_by(Recipe.id.desc()).all()
    return render_template("index.html", recipes=recipes)


@app.route("/register", methods=["GET", "POST"])
def register():
    if current_user.is_authenticated:
        return redirect(url_for("index"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        if not username or not password:
            flash("Username and password are required.", "error")
        elif User.query.filter_by(username=username).first():
            flash("That username is already taken.", "error")
        else:
            user = User(username=username)
            user.set_password(password)
            db.session.add(user)
            db.session.commit()
            login_user(user)
            flash("Welcome! Your account has been created.", "success")
            return redirect(url_for("index"))
    return render_template("register.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if current_user.is_authenticated:
        return redirect(url_for("index"))
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            login_user(user)
            flash("Logged in successfully.", "success")
            next_page = request.args.get("next")
            return redirect(next_page or url_for("index"))
        flash("Invalid username or password.", "error")
    return render_template("login.html")


@app.route("/logout")
@login_required
def logout():
    logout_user()
    flash("You have been logged out.", "success")
    return redirect(url_for("index"))


@app.route("/recipe/<int:recipe_id>")
def view_recipe(recipe_id):
    recipe = db.get_or_404(Recipe, recipe_id)
    return render_template("recipe.html", recipe=recipe)


@app.route("/recipe/new", methods=["GET", "POST"])
@login_required
def new_recipe():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        ingredients = request.form.get("ingredients", "").strip()
        steps = request.form.get("steps", "").strip()
        if not title or not ingredients or not steps:
            flash("Title, ingredients and steps are required.", "error")
            return render_template(
                "recipe_form.html",
                recipe=None,
                form=request.form,
                action=url_for("new_recipe"),
            )
        photo = save_photo(request.files.get("photo"))
        recipe = Recipe(
            title=title,
            ingredients=ingredients,
            steps=steps,
            photo=photo,
            author=current_user,
        )
        db.session.add(recipe)
        db.session.commit()
        flash("Recipe added.", "success")
        return redirect(url_for("view_recipe", recipe_id=recipe.id))
    return render_template(
        "recipe_form.html", recipe=None, form={}, action=url_for("new_recipe")
    )


@app.route("/recipe/<int:recipe_id>/edit", methods=["GET", "POST"])
@login_required
def edit_recipe(recipe_id):
    recipe = db.get_or_404(Recipe, recipe_id)
    if recipe.user_id != current_user.id:
        abort(403)
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        ingredients = request.form.get("ingredients", "").strip()
        steps = request.form.get("steps", "").strip()
        if not title or not ingredients or not steps:
            flash("Title, ingredients and steps are required.", "error")
            return render_template(
                "recipe_form.html",
                recipe=recipe,
                form=request.form,
                action=url_for("edit_recipe", recipe_id=recipe.id),
            )
        recipe.title = title
        recipe.ingredients = ingredients
        recipe.steps = steps
        new_photo = save_photo(request.files.get("photo"))
        if new_photo:
            delete_photo(recipe.photo)
            recipe.photo = new_photo
        elif request.form.get("remove_photo"):
            delete_photo(recipe.photo)
            recipe.photo = None
        db.session.commit()
        flash("Recipe updated.", "success")
        return redirect(url_for("view_recipe", recipe_id=recipe.id))
    return render_template(
        "recipe_form.html",
        recipe=recipe,
        form=recipe.__dict__,
        action=url_for("edit_recipe", recipe_id=recipe.id),
    )


@app.route("/recipe/<int:recipe_id>/delete", methods=["POST"])
@login_required
def delete_recipe(recipe_id):
    recipe = db.get_or_404(Recipe, recipe_id)
    if recipe.user_id != current_user.id:
        abort(403)
    delete_photo(recipe.photo)
    db.session.delete(recipe)
    db.session.commit()
    flash("Recipe deleted.", "success")
    return redirect(url_for("my_recipes"))


@app.route("/my-recipes")
@login_required
def my_recipes():
    recipes = (
        Recipe.query.filter_by(user_id=current_user.id)
        .order_by(Recipe.id.desc())
        .all()
    )
    return render_template("my_recipes.html", recipes=recipes)


with app.app_context():
    db.create_all()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5031, debug=True)
