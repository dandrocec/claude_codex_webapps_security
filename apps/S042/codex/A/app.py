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


app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["DATABASE"] = os.path.join(app.instance_path, "news.sqlite")


def get_db():
    if "db" not in g:
        os.makedirs(app.instance_path, exist_ok=True)
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS authors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            author_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (author_id) REFERENCES authors (id)
        );

        CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            article_id INTEGER NOT NULL,
            commenter_name TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


@app.cli.command("init-db")
def init_db_command():
    init_db()
    print("Initialized the database.")


@app.before_request
def load_logged_in_user():
    init_db()
    user_id = session.get("user_id")
    g.user = None
    if user_id is not None:
        g.user = (
            get_db()
            .execute("SELECT id, username FROM authors WHERE id = ?", (user_id,))
            .fetchone()
        )


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please log in as an author first.")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


@app.route("/")
def index():
    articles = (
        get_db()
        .execute(
            """
            SELECT articles.id, articles.title, articles.body, articles.created_at,
                   authors.username AS author_name,
                   COUNT(comments.id) AS comment_count
            FROM articles
            JOIN authors ON authors.id = articles.author_id
            LEFT JOIN comments ON comments.article_id = articles.id
            GROUP BY articles.id
            ORDER BY articles.created_at DESC
            """
        )
        .fetchall()
    )
    return render_template("index.html", articles=articles)


@app.route("/article/<int:article_id>", methods=("GET", "POST"))
def article(article_id):
    db = get_db()
    article_row = db.execute(
        """
        SELECT articles.id, articles.title, articles.body, articles.created_at,
               authors.username AS author_name
        FROM articles
        JOIN authors ON authors.id = articles.author_id
        WHERE articles.id = ?
        """,
        (article_id,),
    ).fetchone()

    if article_row is None:
        abort(404)

    if request.method == "POST":
        commenter_name = request.form.get("commenter_name", "").strip()
        body = request.form.get("body", "").strip()

        if not commenter_name:
            flash("Name is required.")
        elif not body:
            flash("Comment is required.")
        else:
            db.execute(
                """
                INSERT INTO comments (article_id, commenter_name, body)
                VALUES (?, ?, ?)
                """,
                (article_id, commenter_name, body),
            )
            db.commit()
            flash("Comment posted.")
            return redirect(url_for("article", article_id=article_id))

    comments = db.execute(
        """
        SELECT commenter_name, body, created_at
        FROM comments
        WHERE article_id = ?
        ORDER BY created_at ASC, id ASC
        """,
        (article_id,),
    ).fetchall()
    return render_template("article.html", article=article_row, comments=comments)


@app.route("/publish", methods=("GET", "POST"))
@login_required
def publish():
    if request.method == "POST":
        title = request.form.get("title", "").strip()
        body = request.form.get("body", "").strip()

        if not title:
            flash("Title is required.")
        elif not body:
            flash("Article body is required.")
        else:
            db = get_db()
            db.execute(
                "INSERT INTO articles (author_id, title, body) VALUES (?, ?, ?)",
                (g.user["id"], title, body),
            )
            db.commit()
            flash("Article published.")
            return redirect(url_for("index"))

    return render_template("publish.html")


@app.route("/register", methods=("GET", "POST"))
def register():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        db = get_db()

        if not username:
            flash("Username is required.")
        elif not password:
            flash("Password is required.")
        else:
            try:
                db.execute(
                    """
                    INSERT INTO authors (username, password_hash)
                    VALUES (?, ?)
                    """,
                    (username, generate_password_hash(password)),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already registered.")
            else:
                flash("Registration complete. Please log in.")
                return redirect(url_for("login"))

    return render_template("register.html")


@app.route("/login", methods=("GET", "POST"))
def login():
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        author = (
            get_db()
            .execute("SELECT * FROM authors WHERE username = ?", (username,))
            .fetchone()
        )

        if author is None or not check_password_hash(author["password_hash"], password):
            flash("Invalid username or password.")
        else:
            session.clear()
            session["user_id"] = author["id"]
            flash("Logged in.")
            return redirect(url_for("index"))

    return render_template("login.html")


@app.route("/logout", methods=("POST",))
def logout():
    session.clear()
    flash("Logged out.")
    return redirect(url_for("index"))


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5042, debug=True)
