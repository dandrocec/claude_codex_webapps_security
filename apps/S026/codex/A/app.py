import os
import sqlite3
from functools import wraps

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
from werkzeug.security import check_password_hash, generate_password_hash


DATABASE = os.path.join(os.path.dirname(__file__), "blog.sqlite3")


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
    app.config["DATABASE"] = DATABASE

    @app.before_request
    def load_logged_in_user():
        user_id = session.get("user_id")
        g.user = None
        if user_id is not None:
            g.user = query_db(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
                one=True,
            )

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.route("/")
    def index():
        posts = query_db(
            """
            SELECT posts.id, posts.title, posts.body, posts.created_at,
                   users.username AS author
            FROM posts
            JOIN users ON posts.author_id = users.id
            ORDER BY posts.created_at DESC, posts.id DESC
            """
        )
        return render_template("index.html", posts=posts)

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            error = None

            if not username:
                error = "Username is required."
            elif not password:
                error = "Password is required."
            elif query_db("SELECT id FROM users WHERE username = ?", (username,), one=True):
                error = "That username is already taken."

            if error is None:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                flash("Registration complete. Please log in.")
                return redirect(url_for("login"))

            flash(error)

        return render_template("register.html")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = query_db(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
                one=True,
            )

            if user is None or not check_password_hash(user["password_hash"], password):
                flash("Invalid username or password.")
            else:
                session.clear()
                session["user_id"] = user["id"]
                return redirect(url_for("index"))

        return render_template("login.html")

    @app.route("/logout", methods=("POST",))
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/posts/<int:post_id>")
    def detail(post_id):
        post = get_post(post_id)
        return render_template("detail.html", post=post)

    @app.route("/posts/new", methods=("GET", "POST"))
    @login_required
    def create_post():
        if request.method == "POST":
            title = request.form.get("title", "").strip()
            body = request.form.get("body", "").strip()

            if not title or not body:
                flash("Both title and body are required.")
            else:
                db = get_db()
                cursor = db.execute(
                    "INSERT INTO posts (title, body, author_id) VALUES (?, ?, ?)",
                    (title, body, g.user["id"]),
                )
                db.commit()
                return redirect(url_for("detail", post_id=cursor.lastrowid))

        return render_template("post_form.html", post=None, action="Create")

    @app.route("/posts/<int:post_id>/edit", methods=("GET", "POST"))
    @login_required
    def edit_post(post_id):
        post = get_post(post_id)
        require_owner(post)

        if request.method == "POST":
            title = request.form.get("title", "").strip()
            body = request.form.get("body", "").strip()

            if not title or not body:
                flash("Both title and body are required.")
            else:
                db = get_db()
                db.execute(
                    "UPDATE posts SET title = ?, body = ? WHERE id = ?",
                    (title, body, post_id),
                )
                db.commit()
                return redirect(url_for("detail", post_id=post_id))

        return render_template("post_form.html", post=post, action="Edit")

    @app.route("/posts/<int:post_id>/delete", methods=("POST",))
    @login_required
    def delete_post(post_id):
        post = get_post(post_id)
        require_owner(post)
        db = get_db()
        db.execute("DELETE FROM posts WHERE id = ?", (post_id,))
        db.commit()
        flash("Post deleted.")
        return redirect(url_for("index"))

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_config("DATABASE"))
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


def query_db(query, args=(), one=False):
    cursor = get_db().execute(query, args)
    rows = cursor.fetchall()
    cursor.close()
    return (rows[0] if rows else None) if one else rows


def init_db():
    db = get_db()
    with open(os.path.join(os.path.dirname(__file__), "schema.sql"), encoding="utf-8") as schema:
        db.executescript(schema.read())
    db.commit()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def get_post(post_id):
    post = query_db(
        """
        SELECT posts.id, posts.title, posts.body, posts.created_at,
               posts.author_id, users.username AS author
        FROM posts
        JOIN users ON posts.author_id = users.id
        WHERE posts.id = ?
        """,
        (post_id,),
        one=True,
    )
    if post is None:
        abort(404)
    return post


def require_owner(post):
    if g.user is None or post["author_id"] != g.user["id"]:
        abort(403)


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5026, debug=True)
