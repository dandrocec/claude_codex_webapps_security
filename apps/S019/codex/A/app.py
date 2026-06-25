from difflib import ndiff

from flask import Flask, render_template, request


app = Flask(__name__)


def build_line_diff(left_text, right_text):
    left_lines = left_text.splitlines()
    right_lines = right_text.splitlines()
    rows = []

    for line in ndiff(left_lines, right_lines):
        marker = line[:2]
        content = line[2:]

        if marker == "- ":
            rows.append({"kind": "removed", "label": "-", "text": content})
        elif marker == "+ ":
            rows.append({"kind": "added", "label": "+", "text": content})
        elif marker == "  ":
            rows.append({"kind": "unchanged", "label": " ", "text": content})

    return rows


@app.route("/", methods=["GET", "POST"])
def index():
    left_text = ""
    right_text = ""
    diff_rows = []
    compared = False

    if request.method == "POST":
        left_text = request.form.get("left_text", "")
        right_text = request.form.get("right_text", "")
        diff_rows = build_line_diff(left_text, right_text)
        compared = True

    return render_template(
        "index.html",
        left_text=left_text,
        right_text=right_text,
        diff_rows=diff_rows,
        compared=compared,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5019, debug=True)
