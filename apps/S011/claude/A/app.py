import io
import os
import uuid

from flask import (
    Flask,
    flash,
    redirect,
    render_template,
    request,
    send_from_directory,
    url_for,
)
from PIL import Image
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB upload cap

THUMB_DIR = os.path.join(app.root_path, "thumbnails")
os.makedirs(THUMB_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp", "webp"}
MAX_WIDTH = 5000


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        # Validate the uploaded file.
        if "image" not in request.files:
            flash("No file part in the request.")
            return redirect(url_for("index"))

        file = request.files["image"]
        if file.filename == "":
            flash("No file selected.")
            return redirect(url_for("index"))

        if not allowed_file(file.filename):
            flash("Unsupported file type. Use PNG, JPG, GIF, BMP, or WEBP.")
            return redirect(url_for("index"))

        # Validate the requested width.
        try:
            target_width = int(request.form.get("width", ""))
        except (TypeError, ValueError):
            flash("Please enter a valid target width in pixels.")
            return redirect(url_for("index"))

        if target_width < 1 or target_width > MAX_WIDTH:
            flash(f"Width must be between 1 and {MAX_WIDTH} pixels.")
            return redirect(url_for("index"))

        # Open and resize while preserving aspect ratio.
        try:
            image = Image.open(file.stream)
            image.load()
        except Exception:
            flash("Could not read that image. Is the file valid?")
            return redirect(url_for("index"))

        original_width, original_height = image.size
        target_height = max(1, round(original_height * target_width / original_width))

        resample = getattr(Image, "Resampling", Image).LANCZOS
        thumbnail = image.resize((target_width, target_height), resample)

        # Pick an output format/extension based on the source.
        ext = file.filename.rsplit(".", 1)[1].lower()
        if ext == "jpg":
            ext = "jpeg"
        if thumbnail.mode in ("RGBA", "P") and ext == "jpeg":
            thumbnail = thumbnail.convert("RGB")

        out_name = f"{uuid.uuid4().hex}.{ext}"
        out_path = os.path.join(THUMB_DIR, out_name)
        thumbnail.save(out_path)

        return render_template(
            "index.html",
            thumbnail=out_name,
            original_size=(original_width, original_height),
            new_size=(target_width, target_height),
        )

    return render_template("index.html")


@app.route("/thumbnails/<path:filename>")
def thumbnail_file(filename):
    return send_from_directory(THUMB_DIR, filename)


@app.route("/download/<path:filename>")
def download_file(filename):
    return send_from_directory(THUMB_DIR, filename, as_attachment=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5011, debug=True)
