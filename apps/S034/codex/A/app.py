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


DATABASE = os.path.join(os.path.dirname(__file__), "reading_list.sqlite3")
STATUSES = ("to-read", "reading", "finished")


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-reading-list-key")
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
        if g.user:
            return redirect(url_for("books"))
        return render_template("index.html")

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")

            if not username:
                flash("Username is required.", "error")
            elif not password:
                flash("Password is required.", "error")
            elif query_db("SELECT id FROM users WHERE username = ?", (username,), one=True):
                flash("That username is already taken.", "error")
            else:
                db = get_db()
                cursor = db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                db.commit()
                session.clear()
                session["user_id"] = cursor.lastrowid
                flash("Account created.", "success")
                return redirect(url_for("books"))

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
                flash("Invalid username or password.", "error")
            else:
                session.clear()
                session["user_id"] = user["id"]
                flash("Signed in.", "success")
                return redirect(url_for("books"))

        return render_template("login.html")

    @app.route("/logout", methods=("POST",))
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/books")
    @login_required
    def books():
        selected_status = request.args.get("status", "all")
        params = [g.user["id"]]
        where = "WHERE user_id = ?"

        if selected_status in STATUSES:
            where += " AND status = ?"
            params.append(selected_status)
        else:
            selected_status = "all"

        rows = query_db(
            f"""
            SELECT id, title, author, status, rating, notes, updated_at
            FROM books
            {where}
            ORDER BY
                CASE status
                    WHEN 'reading' THEN 1
                    WHEN 'to-read' THEN 2
                    ELSE 3
                END,
                lower(title)
            """,
            tuple(params),
        )
        counts = {
            row["status"]: row["count"]
            for row in query_db(
                "SELECT status, COUNT(*) AS count FROM books WHERE user_id = ? GROUP BY status",
                (g.user["id"],),
            )
        }
        total = sum(counts.values())
        return render_template(
            "books.html",
            books=rows,
            statuses=STATUSES,
            selected_status=selected_status,
            counts=counts,
            total=total,
        )

    @app.route("/books/new", methods=("GET", "POST"))
    @login_required
    def new_book():
        if request.method == "POST":
            form, errors = validate_book_form(request.form)
            if not errors:
                db = get_db()
                db.execute(
                    """
                    INSERT INTO books (user_id, title, author, status, rating, notes)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        g.user["id"],
                        form["title"],
                        form["author"],
                        form["status"],
                        form["rating"],
                        form["notes"],
                    ),
                )
                db.commit()
                flash("Book added.", "success")
                return redirect(url_for("books"))
            for error in errors:
                flash(error, "error")
        else:
            form = {"title": "", "author": "", "status": "to-read", "rating": "", "notes": ""}

        return render_template("book_form.html", book=form, statuses=STATUSES, action="Add")

    @app.route("/books/<int:book_id>/edit", methods=("GET", "POST"))
    @login_required
    def edit_book(book_id):
        book = get_owned_book(book_id)
        if book is None:
            flash("Book not found.", "error")
            return redirect(url_for("books"))

        if request.method == "POST":
            form, errors = validate_book_form(request.form)
            if not errors:
                db = get_db()
                db.execute(
                    """
                    UPDATE books
                    SET title = ?, author = ?, status = ?, rating = ?, notes = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        form["title"],
                        form["author"],
                        form["status"],
                        form["rating"],
                        form["notes"],
                        book_id,
                        g.user["id"],
                    ),
                )
                db.commit()
                flash("Book updated.", "success")
                return redirect(url_for("books"))
            for error in errors:
                flash(error, "error")
            book = form

        return render_template("book_form.html", book=book, statuses=STATUSES, action="Update")

    @app.route("/books/<int:book_id>/status", methods=("POST",))
    @login_required
    def update_status(book_id):
        status = request.form.get("status", "")
        if status not in STATUSES:
            flash("Choose a valid status.", "error")
        else:
            db = get_db()
            db.execute(
                """
                UPDATE books
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND user_id = ?
                """,
                (status, book_id, g.user["id"]),
            )
            db.commit()
            flash("Progress updated.", "success")
        return redirect(url_for("books"))

    @app.route("/books/<int:book_id>/delete", methods=("POST",))
    @login_required
    def delete_book(book_id):
        db = get_db()
        db.execute("DELETE FROM books WHERE id = ? AND user_id = ?", (book_id, g.user["id"]))
        db.commit()
        flash("Book removed.", "success")
        return redirect(url_for("books"))

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_database())
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_database():
    from flask import current_app

    return current_app.config["DATABASE"]


def query_db(query, args=(), one=False):
    cursor = get_db().execute(query, args)
    rows = cursor.fetchall()
    cursor.close()
    return (rows[0] if rows else None) if one else rows


def init_db():
    db = get_db()
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS books (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            author TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'to-read'
                CHECK (status IN ('to-read', 'reading', 'finished')),
            rating INTEGER CHECK (rating IS NULL OR rating BETWEEN 1 AND 5),
            notes TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please sign in first.", "error")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def validate_book_form(form_data):
    title = form_data.get("title", "").strip()
    author = form_data.get("author", "").strip()
    status = form_data.get("status", "to-read")
    notes = form_data.get("notes", "").strip()
    rating_raw = form_data.get("rating", "").strip()
    errors = []

    if not title:
        errors.append("Title is required.")
    if not author:
        errors.append("Author is required.")
    if status not in STATUSES:
        errors.append("Choose a valid status.")

    rating = None
    if rating_raw:
        try:
            rating = int(rating_raw)
            if rating < 1 or rating > 5:
                errors.append("Rating must be between 1 and 5.")
        except ValueError:
            errors.append("Rating must be a number from 1 to 5.")

    return (
        {
            "title": title,
            "author": author,
            "status": status,
            "rating": rating,
            "notes": notes,
        },
        errors,
    )


def get_owned_book(book_id):
    return query_db(
        """
        SELECT id, title, author, status, rating, notes
        FROM books
        WHERE id = ? AND user_id = ?
        """,
        (book_id, g.user["id"]),
        one=True,
    )


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5034, debug=True)
