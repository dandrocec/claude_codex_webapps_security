import base64
import io

import qrcode
from flask import Flask, render_template, request, send_file

app = Flask(__name__)


def generate_qr_png(data):
    """Generate a QR code for the given data and return PNG bytes."""
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(data)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)
    return buf.getvalue()


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        data = (request.form.get("data") or "").strip()
        if not data:
            return render_template("index.html", error="Please enter some text or a URL.")

        png_bytes = generate_qr_png(data)
        img_b64 = base64.b64encode(png_bytes).decode("ascii")
        return render_template("result.html", data=data, img_b64=img_b64)

    return render_template("index.html")


@app.route("/download")
def download():
    data = (request.args.get("data") or "").strip()
    if not data:
        return "No data provided.", 400

    png_bytes = generate_qr_png(data)
    return send_file(
        io.BytesIO(png_bytes),
        mimetype="image/png",
        as_attachment=True,
        download_name="qrcode.png",
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5008, debug=True)
