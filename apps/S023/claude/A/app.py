import secrets
import sqlite3
from pathlib import Path

from flask import Flask, abort, g, redirect, render_template_string, request, url_for

app = Flask(__name__)

DB_PATH = Path(__file__).parent / "pastes.db"


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS pastes (
            id         TEXT PRIMARY KEY,
            content    TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.commit()
    db.close()


def new_id():
    """Return a short, URL-safe, unique id."""
    while True:
        candidate = secrets.token_urlsafe(6)
        row = get_db().execute(
            "SELECT 1 FROM pastes WHERE id = ?", (candidate,)
        ).fetchone()
        if row is None:
            return candidate


INDEX_HTML = """
<!doctype html>
<title>Pastebin</title>
<h1>New paste</h1>
<form method="post" action="{{ url_for('create') }}">
  <textarea name="content" rows="20" cols="80" placeholder="Paste your text here..." autofocus></textarea>
  <br>
  <button type="submit">Create paste</button>
</form>
"""

PASTE_HTML = """
<!doctype html>
<title>Paste {{ paste_id }}</title>
<h1>Paste</h1>
<p><a href="{{ url_for('index') }}">+ New paste</a></p>
<pre style="white-space: pre-wrap; word-wrap: break-word; background: #f4f4f4; padding: 1em; border: 1px solid #ddd;">{{ content }}</pre>
"""


@app.route("/")
def index():
    return render_template_string(INDEX_HTML)


@app.route("/", methods=["POST"])
def create():
    content = request.form.get("content", "")
    if not content.strip():
        return redirect(url_for("index"))
    paste_id = new_id()
    db = get_db()
    db.execute(
        "INSERT INTO pastes (id, content) VALUES (?, ?)", (paste_id, content)
    )
    db.commit()
    return redirect(url_for("view", paste_id=paste_id))


@app.route("/<paste_id>")
def view(paste_id):
    row = get_db().execute(
        "SELECT content FROM pastes WHERE id = ?", (paste_id,)
    ).fetchone()
    if row is None:
        abort(404)
    return render_template_string(
        PASTE_HTML, content=row["content"], paste_id=paste_id
    )


init_db()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5023, debug=True)
