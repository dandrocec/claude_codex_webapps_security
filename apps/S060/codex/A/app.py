import os
import sqlite3
from functools import wraps
from werkzeug.security import check_password_hash, generate_password_hash
from flask import (
    Flask,
    abort,
    flash,
    g,
    redirect,
    render_template,
    request,
    session,
    url_for,
)


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.path.join(BASE_DIR, "blog.db")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-key-change-me")


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
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('reader', 'author', 'editor'))
        );

        CREATE TABLE IF NOT EXISTS posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
            rejection_reason TEXT,
            author_id INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(author_id) REFERENCES users(id)
        );
        """
    )

    users = [
        ("reader", "readerpass", "reader"),
        ("author", "authorpass", "author"),
        ("editor", "editorpass", "editor"),
    ]
    for username, password, role in users:
        db.execute(
            """
            INSERT OR IGNORE INTO users (username, password_hash, role)
            VALUES (?, ?, ?)
            """,
            (username, generate_password_hash(password), role),
        )
    db.commit()


@app.before_request
def load_logged_in_user():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, username, role FROM users WHERE id = ?", (user_id,)
        ).fetchone()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please sign in first.", "warning")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def role_required(*roles):
    def decorator(view):
        @wraps(view)
        def wrapped_view(**kwargs):
            if g.user is None:
                flash("Please sign in first.", "warning")
                return redirect(url_for("login"))
            if g.user["role"] not in roles:
                abort(403)
            return view(**kwargs)

        return wrapped_view

    return decorator


@app.route("/")
def index():
    posts = get_db().execute(
        """
        SELECT posts.*, users.username AS author_name
        FROM posts
        JOIN users ON users.id = posts.author_id
        WHERE posts.status = 'approved'
        ORDER BY posts.created_at DESC
        """
    ).fetchall()
    return render_template("index.html", posts=posts)


@app.route("/post/<int:post_id>")
def public_post(post_id):
    post = get_db().execute(
        """
        SELECT posts.*, users.username AS author_name
        FROM posts
        JOIN users ON users.id = posts.author_id
        WHERE posts.id = ? AND posts.status = 'approved'
        """,
        (post_id,),
    ).fetchone()
    if post is None:
        abort(404)
    return render_template("post_detail.html", post=post)


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form["username"].strip()
        password = request.form["password"]
        user = get_db().execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        ).fetchone()

        if user is None or not check_password_hash(user["password_hash"], password):
            flash("Invalid username or password.", "error")
        else:
            session.clear()
            session["user_id"] = user["id"]
            flash(f"Welcome back, {user['username']}.", "success")
            return redirect(url_for("dashboard"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Signed out.", "success")
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    role = g.user["role"]
    if role == "author":
        posts = get_db().execute(
            """
            SELECT * FROM posts
            WHERE author_id = ?
            ORDER BY updated_at DESC
            """,
            (g.user["id"],),
        ).fetchall()
        return render_template("dashboard_author.html", posts=posts)

    if role == "editor":
        pending = get_db().execute(
            """
            SELECT posts.*, users.username AS author_name
            FROM posts
            JOIN users ON users.id = posts.author_id
            WHERE posts.status = 'submitted'
            ORDER BY posts.created_at ASC
            """
        ).fetchall()
        recent = get_db().execute(
            """
            SELECT posts.*, users.username AS author_name
            FROM posts
            JOIN users ON users.id = posts.author_id
            WHERE posts.status IN ('approved', 'rejected')
            ORDER BY posts.updated_at DESC
            LIMIT 10
            """
        ).fetchall()
        return render_template("dashboard_editor.html", pending=pending, recent=recent)

    approved = get_db().execute(
        """
        SELECT posts.*, users.username AS author_name
        FROM posts
        JOIN users ON users.id = posts.author_id
        WHERE posts.status = 'approved'
        ORDER BY posts.created_at DESC
        """
    ).fetchall()
    return render_template("dashboard_reader.html", posts=approved)


@app.route("/author/posts/new", methods=("GET", "POST"))
@role_required("author")
def new_post():
    if request.method == "POST":
        title = request.form["title"].strip()
        body = request.form["body"].strip()
        action = request.form.get("action", "draft")
        status = "submitted" if action == "submit" else "draft"

        if not title or not body:
            flash("Title and body are required.", "error")
        else:
            get_db().execute(
                """
                INSERT INTO posts (title, body, status, author_id)
                VALUES (?, ?, ?, ?)
                """,
                (title, body, status, g.user["id"]),
            )
            get_db().commit()
            flash("Post submitted for review." if status == "submitted" else "Draft saved.", "success")
            return redirect(url_for("dashboard"))

    return render_template("post_form.html", post=None)


@app.route("/author/posts/<int:post_id>/edit", methods=("GET", "POST"))
@role_required("author")
def edit_post(post_id):
    post = get_author_post(post_id)
    if post["status"] == "approved":
        flash("Approved posts cannot be edited.", "warning")
        return redirect(url_for("dashboard"))

    if request.method == "POST":
        title = request.form["title"].strip()
        body = request.form["body"].strip()
        action = request.form.get("action", "draft")
        status = "submitted" if action == "submit" else "draft"

        if not title or not body:
            flash("Title and body are required.", "error")
        else:
            get_db().execute(
                """
                UPDATE posts
                SET title = ?, body = ?, status = ?, rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND author_id = ?
                """,
                (title, body, status, post_id, g.user["id"]),
            )
            get_db().commit()
            flash("Post submitted for review." if status == "submitted" else "Draft updated.", "success")
            return redirect(url_for("dashboard"))

    return render_template("post_form.html", post=post)


@app.route("/author/posts/<int:post_id>/submit", methods=("POST",))
@role_required("author")
def submit_post(post_id):
    post = get_author_post(post_id)
    if post["status"] == "approved":
        flash("Approved posts are already public.", "warning")
    else:
        get_db().execute(
            """
            UPDATE posts
            SET status = 'submitted', rejection_reason = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND author_id = ?
            """,
            (post_id, g.user["id"]),
        )
        get_db().commit()
        flash("Post submitted for review.", "success")
    return redirect(url_for("dashboard"))


@app.route("/editor/posts/<int:post_id>/approve", methods=("POST",))
@role_required("editor")
def approve_post(post_id):
    update_review_status(post_id, "approved", None)
    flash("Post approved and published.", "success")
    return redirect(url_for("dashboard"))


@app.route("/editor/posts/<int:post_id>/reject", methods=("POST",))
@role_required("editor")
def reject_post(post_id):
    reason = request.form.get("reason", "").strip()
    update_review_status(post_id, "rejected", reason or "No reason provided.")
    flash("Post rejected.", "success")
    return redirect(url_for("dashboard"))


def get_author_post(post_id):
    post = get_db().execute(
        "SELECT * FROM posts WHERE id = ? AND author_id = ?", (post_id, g.user["id"])
    ).fetchone()
    if post is None:
        abort(404)
    return post


def update_review_status(post_id, status, reason):
    post = get_db().execute(
        "SELECT id FROM posts WHERE id = ? AND status = 'submitted'", (post_id,)
    ).fetchone()
    if post is None:
        abort(404)
    get_db().execute(
        """
        UPDATE posts
        SET status = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (status, reason, post_id),
    )
    get_db().commit()


@app.errorhandler(403)
def forbidden(error):
    return render_template("error.html", code=403, message="You do not have access to that page."), 403


@app.errorhandler(404)
def not_found(error):
    return render_template("error.html", code=404, message="That page was not found."), 404


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(host="127.0.0.1", port=5060, debug=True)

