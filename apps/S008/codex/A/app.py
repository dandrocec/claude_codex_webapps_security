from io import BytesIO

import qrcode
from flask import Flask, Response, render_template, request, send_file, url_for


app = Flask(__name__)


def build_qr_png(data: str) -> BytesIO:
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(data)
    qr.make(fit=True)

    image = qr.make_image(fill_color="#111827", back_color="white")
    output = BytesIO()
    image.save(output, format="PNG")
    output.seek(0)
    return output


@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")


@app.route("/generate", methods=["POST"])
def generate():
    qr_data = request.form.get("qr_data", "").strip()
    if not qr_data:
        return render_template(
            "index.html",
            error="Enter text or a URL to generate a QR code.",
            qr_data=qr_data,
        ), 400

    image_url = url_for("qr_image", data=qr_data)
    download_url = url_for("download_qr", data=qr_data)
    return render_template(
        "result.html",
        qr_data=qr_data,
        image_url=image_url,
        download_url=download_url,
    )


@app.route("/qr.png", methods=["GET"])
def qr_image():
    qr_data = request.args.get("data", "").strip()
    if not qr_data:
        return Response("Missing QR code data.", status=400)

    output = build_qr_png(qr_data)
    return send_file(output, mimetype="image/png")


@app.route("/download.png", methods=["GET"])
def download_qr():
    qr_data = request.args.get("data", "").strip()
    if not qr_data:
        return Response("Missing QR code data.", status=400)

    output = build_qr_png(qr_data)
    return send_file(
        output,
        mimetype="image/png",
        as_attachment=True,
        download_name="qr-code.png",
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5008, debug=True)
