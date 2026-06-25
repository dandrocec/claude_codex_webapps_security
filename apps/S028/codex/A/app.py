import os
import sqlite3
from functools import wraps

from flask import (
    Flask,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from werkzeug.security import check_password_hash, generate_password_hash


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "notes.db")


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        );
        """
    )
    db.commit()


@app.before_request
def load_current_user():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please log in first.", "warning")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


@app.route("/")
def index():
    if g.user is None:
        return redirect(url_for("login"))

    notes = get_db().execute(
        """
        SELECT id, title, body, created_at, updated_at
        FROM notes
        WHERE user_id = ?
        ORDER BY updated_at DESC, id DESC
        """,
        (g.user["id"],),
    ).fetchall()
    return render_template("notes.html", notes=notes)


@app.route("/register", methods=("GET", "POST"))
def register():
    if g.user is not None:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        error = None

        if not username:
            error = "Username is required."
        elif not password:
            error = "Password is required."

        if error is None:
            try:
                db = get_db()
                cursor = db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                session.clear()
                session["user_id"] = cursor.lastrowid
                flash("Account created.", "success")
                return redirect(url_for("index"))
            except sqlite3.IntegrityError:
                error = "That username is already taken."

        flash(error, "error")

    return render_template("auth.html", mode="register")


@app.route("/login", methods=("GET", "POST"))
def login():
    if g.user is not None:
        return redirect(url_for("index"))

    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        user = get_db().execute(
            "SELECT id, username, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash("Logged in.", "success")
            return redirect(url_for("index"))

    return render_template("auth.html", mode="login")


@app.route("/logout", methods=("POST",))
def logout():
    session.clear()
    flash("Logged out.", "success")
    return redirect(url_for("login"))


@app.route("/notes/new", methods=("GET", "POST"))
@login_required
def create_note():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()

        if not title:
            flash("Title is required.", "error")
        else:
            get_db().execute(
                "INSERT INTO notes (user_id, title, body) VALUES (?, ?, ?)",
                (g.user["id"], title, body),
            )
            get_db().commit()
            flash("Note created.", "success")
            return redirect(url_for("index"))

    return render_template("note_form.html", note=None)


def get_user_note(note_id):
    note = get_db().execute(
        """
        SELECT id, title, body, created_at, updated_at
        FROM notes
        WHERE id = ? AND user_id = ?
        """,
        (note_id, g.user["id"]),
    ).fetchone()
    if note is None:
        flash("Note not found.", "error")
        return None
    return note


@app.route("/notes/<int:note_id>/edit", methods=("GET", "POST"))
@login_required
def edit_note(note_id):
    note = get_user_note(note_id)
    if note is None:
        return redirect(url_for("index"))

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()

        if not title:
            flash("Title is required.", "error")
        else:
            get_db().execute(
                """
                UPDATE notes
                SET title = ?, body = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (title, body, note_id, g.user["id"]),
            )
            get_db().commit()
            flash("Note updated.", "success")
            return redirect(url_for("index"))

    return render_template("note_form.html", note=note)


@app.route("/notes/<int:note_id>/delete", methods=("POST",))
@login_required
def delete_note(note_id):
    get_db().execute(
        "DELETE FROM notes WHERE id = ? AND user_id = ?", (note_id, g.user["id"])
    )
    get_db().commit()
    flash("Note deleted.", "success")
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5028, debug=True)
