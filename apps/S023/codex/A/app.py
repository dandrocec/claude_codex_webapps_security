import os
import secrets
import sqlite3
from datetime import datetime, timezone

from flask import Flask, abort, g, redirect, render_template, request, url_for


DATABASE = os.environ.get("PASTEBIN_DATABASE", "pastes.db")

app = Flask(__name__)


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS pastes (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    db.commit()


@app.before_request
def ensure_database():
    init_db()


def generate_paste_id():
    db = get_db()
    while True:
        paste_id = secrets.token_urlsafe(8)
        existing = db.execute(
            "SELECT 1 FROM pastes WHERE id = ?",
            (paste_id,),
        ).fetchone()
        if existing is None:
            return paste_id


@app.route("/", methods=["GET", "POST"])
def index():
    if request.method == "POST":
        content = request.form.get("content", "").strip()
        if not content:
            return render_template("index.html", error="Paste text is required.", content=content), 400

        paste_id = generate_paste_id()
        created_at = datetime.now(timezone.utc).isoformat()
        db = get_db()
        db.execute(
            "INSERT INTO pastes (id, content, created_at) VALUES (?, ?, ?)",
            (paste_id, content, created_at),
        )
        db.commit()
        return redirect(url_for("show_paste", paste_id=paste_id))

    return render_template("index.html")


@app.route("/p/<paste_id>")
def show_paste(paste_id):
    paste = get_db().execute(
        "SELECT id, content, created_at FROM pastes WHERE id = ?",
        (paste_id,),
    ).fetchone()
    if paste is None:
        abort(404)
    return render_template("paste.html", paste=paste)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5023, debug=True)
