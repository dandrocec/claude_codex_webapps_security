import difflib

from flask import Flask, render_template, request

app = Flask(__name__)

PORT = 5019


def compute_diff(text_a, text_b):
    """Return a list of line-by-line diff rows comparing text_a to text_b.

    Each row is a dict with a ``tag`` describing the change and the line text.
    Tags: ``equal``, ``add`` (present only in B), ``remove`` (present only in A).
    """
    lines_a = text_a.splitlines()
    lines_b = text_b.splitlines()

    matcher = difflib.SequenceMatcher(a=lines_a, b=lines_b)
    rows = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for line in lines_a[i1:i2]:
                rows.append({"tag": "equal", "text": line})
        elif tag == "delete":
            for line in lines_a[i1:i2]:
                rows.append({"tag": "remove", "text": line})
        elif tag == "insert":
            for line in lines_b[j1:j2]:
                rows.append({"tag": "add", "text": line})
        elif tag == "replace":
            for line in lines_a[i1:i2]:
                rows.append({"tag": "remove", "text": line})
            for line in lines_b[j1:j2]:
                rows.append({"tag": "add", "text": line})

    return rows


@app.route("/", methods=["GET", "POST"])
def index():
    text_a = ""
    text_b = ""
    diff_rows = None

    if request.method == "POST":
        text_a = request.form.get("text_a", "")
        text_b = request.form.get("text_b", "")
        diff_rows = compute_diff(text_a, text_b)

    return render_template(
        "index.html", text_a=text_a, text_b=text_b, diff_rows=diff_rows
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT, debug=True)
