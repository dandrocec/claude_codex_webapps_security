import os
import sqlite3
import uuid
from functools import wraps
from pathlib import Path

from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from flask_bcrypt import Bcrypt
from flask_wtf import CSRFProtect, FlaskForm
from PIL import Image, UnidentifiedImageError
from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import RequestEntityTooLarge
from wtforms import FileField, IntegerField, PasswordField, StringField, SubmitField
from wtforms.validators import DataRequired, Email, Length, NumberRange


BASE_DIR = Path(__file__).resolve().parent
INSTANCE_DIR = BASE_DIR / "instance"
UPLOAD_DIR = INSTANCE_DIR / "uploads"
THUMBNAIL_DIR = INSTANCE_DIR / "thumbnails"
DB_PATH = INSTANCE_DIR / "app.sqlite3"

ALLOWED_FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MIN_WIDTH = 16
MAX_WIDTH = 2000
Image.MAX_IMAGE_PIXELS = 20_000_000


app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY", os.urandom(32)),
    MAX_CONTENT_LENGTH=MAX_IMAGE_BYTES,
    WTF_CSRF_TIME_LIMIT=3600,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
    == "true",
    SESSION_COOKIE_SAMESITE="Lax",
)

bcrypt = Bcrypt(app)
csrf = CSRFProtect(app)


class RegisterForm(FlaskForm):
    email = StringField(
        "Email", validators=[DataRequired(), Email(), Length(max=254)]
    )
    password = PasswordField(
        "Password", validators=[DataRequired(), Length(min=12, max=128)]
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField(
        "Email", validators=[DataRequired(), Email(), Length(max=254)]
    )
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Sign in")


class ResizeForm(FlaskForm):
    image = FileField("Image", validators=[DataRequired()])
    width = IntegerField(
        "Target width",
        validators=[DataRequired(), NumberRange(min=MIN_WIDTH, max=MAX_WIDTH)],
    )
    submit = SubmitField("Resize image")


def ensure_storage() -> None:
    INSTANCE_DIR.mkdir(mode=0o700, exist_ok=True)
    UPLOAD_DIR.mkdir(mode=0o700, exist_ok=True)
    THUMBNAIL_DIR.mkdir(mode=0o700, exist_ok=True)


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error=None) -> None:
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    ensure_storage()
    db = sqlite3.connect(DB_PATH)
    try:
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                original_path TEXT NOT NULL,
                thumbnail_path TEXT NOT NULL,
                original_format TEXT NOT NULL,
                target_width INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
            )
            """
        )
        db.commit()
    finally:
        db.close()


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return get_db().execute("SELECT id, email FROM users WHERE id = ?", (user_id,)).fetchone()


@app.before_request
def load_user() -> None:
    g.user = current_user()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Please sign in first.", "warning")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def normalise_email(email: str) -> str:
    return email.strip().lower()


def random_file_path(directory: Path, extension: str) -> Path:
    safe_extension = extension.lower().lstrip(".")
    if safe_extension not in ALLOWED_FORMATS.values():
        abort(400)
    path = (directory / f"{uuid.uuid4().hex}.{safe_extension}").resolve()
    if directory.resolve() not in path.parents:
        abort(400)
    return path


def inspect_image_upload(upload: FileStorage) -> tuple[Image.Image, str]:
    if not upload or not upload.stream:
        abort(400)

    upload.stream.seek(0, os.SEEK_END)
    size = upload.stream.tell()
    upload.stream.seek(0)
    if size <= 0 or size > MAX_IMAGE_BYTES:
        abort(400)

    try:
        with Image.open(upload.stream) as candidate:
            candidate.verify()
            image_format = candidate.format
        if image_format not in ALLOWED_FORMATS:
            abort(400)
        upload.stream.seek(0)
        image = Image.open(upload.stream)
        image.load()
        return image, image_format
    except (UnidentifiedImageError, OSError, ValueError):
        abort(400)


@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "img-src 'self' data:; "
        "style-src 'self'; "
        "script-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.errorhandler(400)
def bad_request(_error):
    return render_template("error.html", message="The request could not be processed."), 400


@app.errorhandler(403)
def forbidden(_error):
    return render_template("error.html", message="You do not have access to that resource."), 403


@app.errorhandler(404)
def not_found(_error):
    return render_template("error.html", message="The requested page was not found."), 404


@app.errorhandler(500)
def server_error(_error):
    return render_template("error.html", message="An internal error occurred."), 500


@app.errorhandler(RequestEntityTooLarge)
def too_large(_error):
    return render_template("error.html", message="Uploaded images must be 5 MB or smaller."), 413


@app.route("/")
def index():
    if g.user is None:
        return redirect(url_for("login"))
    images = get_db().execute(
        """
        SELECT id, target_width, created_at
        FROM images
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        """,
        (g.user["id"],),
    ).fetchall()
    return render_template("index.html", form=ResizeForm(), images=images)


@app.route("/register", methods=["GET", "POST"])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        email = normalise_email(form.email.data)
        password_hash = bcrypt.generate_password_hash(form.password.data).decode("utf-8")
        try:
            cursor = get_db().execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, password_hash),
            )
            get_db().commit()
        except sqlite3.IntegrityError:
            flash("An account with that email already exists.", "error")
            return render_template("register.html", form=form), 400

        session.clear()
        session["user_id"] = cursor.lastrowid
        session.permanent = True
        return redirect(url_for("index"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        email = normalise_email(form.email.data)
        user = get_db().execute(
            "SELECT id, password_hash FROM users WHERE email = ?", (email,)
        ).fetchone()
        if user and bcrypt.check_password_hash(user["password_hash"], form.password.data):
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            return redirect(url_for("index"))
        flash("Invalid email or password.", "error")
    return render_template("login.html", form=form)


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.route("/resize", methods=["POST"])
@login_required
def resize():
    form = ResizeForm()
    if not form.validate_on_submit():
        flash("Choose a valid image and a width between 16 and 2000 pixels.", "error")
        return redirect(url_for("index"))

    image, image_format = inspect_image_upload(form.image.data)
    target_width = int(form.width.data)
    target_height = max(1, round(image.height * (target_width / image.width)))
    output_extension = ALLOWED_FORMATS[image_format]
    original_path = random_file_path(UPLOAD_DIR, output_extension)
    thumbnail_path = random_file_path(THUMBNAIL_DIR, output_extension)

    if image_format == "JPEG":
        image = image.convert("RGB")

    image.save(original_path, format=image_format)
    thumbnail = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
    thumbnail.save(thumbnail_path, format=image_format)

    cursor = get_db().execute(
        """
        INSERT INTO images (user_id, original_path, thumbnail_path, original_format, target_width)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            g.user["id"],
            str(original_path),
            str(thumbnail_path),
            image_format,
            target_width,
        ),
    )
    get_db().commit()
    return redirect(url_for("image_detail", image_id=cursor.lastrowid))


@app.route("/images/<int:image_id>")
@login_required
def image_detail(image_id: int):
    image = get_db().execute(
        """
        SELECT id, target_width, created_at
        FROM images
        WHERE id = ? AND user_id = ?
        """,
        (image_id, g.user["id"]),
    ).fetchone()
    if image is None:
        abort(404)
    return render_template("detail.html", image=image)


@app.route("/images/<int:image_id>/thumbnail")
@login_required
def thumbnail(image_id: int):
    image = get_db().execute(
        "SELECT thumbnail_path FROM images WHERE id = ? AND user_id = ?",
        (image_id, g.user["id"]),
    ).fetchone()
    if image is None:
        abort(404)

    path = Path(image["thumbnail_path"]).resolve()
    if THUMBNAIL_DIR.resolve() not in path.parents or not path.is_file():
        abort(404)
    return send_file(path)


@app.route("/images/<int:image_id>/download")
@login_required
def download(image_id: int):
    image = get_db().execute(
        "SELECT thumbnail_path FROM images WHERE id = ? AND user_id = ?",
        (image_id, g.user["id"]),
    ).fetchone()
    if image is None:
        abort(404)

    path = Path(image["thumbnail_path"]).resolve()
    if THUMBNAIL_DIR.resolve() not in path.parents or not path.is_file():
        abort(404)
    return send_file(path, as_attachment=True, download_name=f"thumbnail-{image_id}{path.suffix}")


init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5011)
