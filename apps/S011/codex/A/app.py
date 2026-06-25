import os
from pathlib import Path
from uuid import uuid4

from flask import Flask, flash, redirect, render_template, request, send_from_directory, url_for
from PIL import Image, UnidentifiedImageError
from werkzeug.utils import secure_filename


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_FOLDER = BASE_DIR / "uploads"
THUMBNAIL_FOLDER = BASE_DIR / "thumbnails"
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "webp"}
MAX_WIDTH = 5000


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024


UPLOAD_FOLDER.mkdir(exist_ok=True)
THUMBNAIL_FOLDER.mkdir(exist_ok=True)


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def resize_image(source_path, output_path, target_width):
    with Image.open(source_path) as image:
        original_width, original_height = image.size
        if original_width == 0:
            raise ValueError("Invalid image dimensions.")

        target_height = max(1, round(original_height * (target_width / original_width)))
        resized = image.copy()
        resized.thumbnail((target_width, target_height), Image.Resampling.LANCZOS)

        if resized.mode in ("RGBA", "P") and output_path.suffix.lower() in {".jpg", ".jpeg"}:
            resized = resized.convert("RGB")

        resized.save(output_path)
        return resized.size


@app.route("/", methods=["GET", "POST"])
def index():
    result = None

    if request.method == "POST":
        image_file = request.files.get("image")
        width_value = request.form.get("width", "").strip()

        if not image_file or image_file.filename == "":
            flash("Choose an image to upload.")
            return redirect(url_for("index"))

        if not allowed_file(image_file.filename):
            flash("Upload a PNG, JPG, JPEG, GIF, or WEBP image.")
            return redirect(url_for("index"))

        try:
            target_width = int(width_value)
        except ValueError:
            flash("Enter a valid target width.")
            return redirect(url_for("index"))

        if target_width < 1 or target_width > MAX_WIDTH:
            flash(f"Target width must be between 1 and {MAX_WIDTH} pixels.")
            return redirect(url_for("index"))

        safe_name = secure_filename(image_file.filename)
        extension = safe_name.rsplit(".", 1)[1].lower()
        file_id = uuid4().hex
        upload_name = f"{file_id}_{safe_name}"
        thumbnail_name = f"{file_id}_thumbnail.{extension}"
        upload_path = UPLOAD_FOLDER / upload_name
        thumbnail_path = THUMBNAIL_FOLDER / thumbnail_name

        image_file.save(upload_path)

        try:
            final_width, final_height = resize_image(upload_path, thumbnail_path, target_width)
        except (UnidentifiedImageError, OSError, ValueError):
            upload_path.unlink(missing_ok=True)
            thumbnail_path.unlink(missing_ok=True)
            flash("The uploaded file could not be processed as an image.")
            return redirect(url_for("index"))

        result = {
            "filename": thumbnail_name,
            "width": final_width,
            "height": final_height,
            "preview_url": url_for("thumbnail_file", filename=thumbnail_name),
            "download_url": url_for("download_file", filename=thumbnail_name),
        }

    return render_template("index.html", result=result)


@app.route("/thumbnails/<path:filename>")
def thumbnail_file(filename):
    return send_from_directory(THUMBNAIL_FOLDER, filename)


@app.route("/download/<path:filename>")
def download_file(filename):
    return send_from_directory(THUMBNAIL_FOLDER, filename, as_attachment=True)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5011, debug=True)
