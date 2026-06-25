from datetime import date, datetime
import os
import sqlite3

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


DATABASE = os.path.join(os.path.dirname(__file__), "events.sqlite3")


def create_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-change-me")
    app.config["DATABASE"] = os.environ.get("DATABASE", DATABASE)

    @app.before_request
    def load_logged_in_user():
        user_id = session.get("user_id")
        g.user = None
        if user_id is not None:
            g.user = query_one(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            )

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.route("/")
    def index():
        today = date.today().isoformat()
        events = query_all(
            """
            SELECT events.*, users.username AS organiser
            FROM events
            JOIN users ON users.id = events.user_id
            WHERE event_date >= ?
            ORDER BY event_date ASC, title ASC
            """,
            (today,),
        )
        return render_template("index.html", events=events)

    @app.route("/register", methods=("GET", "POST"))
    def register():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")

            if not username or not password:
                flash("Username and password are required.", "error")
            elif query_one("SELECT id FROM users WHERE username = ?", (username,)):
                flash("That username is already registered.", "error")
            else:
                execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, generate_password_hash(password)),
                )
                flash("Account created. Please sign in.", "success")
                return redirect(url_for("login"))

        return render_template("register.html")

    @app.route("/login", methods=("GET", "POST"))
    def login():
        if request.method == "POST":
            username = request.form.get("username", "").strip()
            password = request.form.get("password", "")
            user = query_one("SELECT * FROM users WHERE username = ?", (username,))

            if user is None or not check_password_hash(user["password_hash"], password):
                flash("Invalid username or password.", "error")
            else:
                session.clear()
                session["user_id"] = user["id"]
                return redirect(url_for("dashboard"))

        return render_template("login.html")

    @app.route("/logout")
    def logout():
        session.clear()
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        events = query_all(
            """
            SELECT *
            FROM events
            WHERE user_id = ?
            ORDER BY event_date ASC, title ASC
            """,
            (g.user["id"],),
        )
        return render_template("dashboard.html", events=events)

    @app.route("/events/new", methods=("GET", "POST"))
    @login_required
    def create_event():
        if request.method == "POST":
            data, errors = event_form_data()
            if errors:
                for error in errors:
                    flash(error, "error")
            else:
                execute(
                    """
                    INSERT INTO events (user_id, title, event_date, location, description)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        g.user["id"],
                        data["title"],
                        data["event_date"],
                        data["location"],
                        data["description"],
                    ),
                )
                flash("Event created.", "success")
                return redirect(url_for("dashboard"))

        return render_template("event_form.html", event=None, heading="Create event")

    @app.route("/events/<int:event_id>/edit", methods=("GET", "POST"))
    @login_required
    def edit_event(event_id):
        event = organiser_event_or_404(event_id)

        if request.method == "POST":
            data, errors = event_form_data()
            if errors:
                for error in errors:
                    flash(error, "error")
            else:
                execute(
                    """
                    UPDATE events
                    SET title = ?, event_date = ?, location = ?, description = ?
                    WHERE id = ? AND user_id = ?
                    """,
                    (
                        data["title"],
                        data["event_date"],
                        data["location"],
                        data["description"],
                        event_id,
                        g.user["id"],
                    ),
                )
                flash("Event updated.", "success")
                return redirect(url_for("dashboard"))

        return render_template("event_form.html", event=event, heading="Edit event")

    @app.route("/events/<int:event_id>/delete", methods=("POST",))
    @login_required
    def delete_event(event_id):
        organiser_event_or_404(event_id)
        execute("DELETE FROM events WHERE id = ? AND user_id = ?", (event_id, g.user["id"]))
        flash("Event deleted.", "success")
        return redirect(url_for("dashboard"))

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(current_app_config("DATABASE"))
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_config(key):
    from flask import current_app

    return current_app.config[key]


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

        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            event_date TEXT NOT NULL,
            location TEXT NOT NULL,
            description TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    db.execute(sql, params)
    db.commit()


def login_required(view):
    from functools import wraps

    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def organiser_event_or_404(event_id):
    event = query_one(
        "SELECT * FROM events WHERE id = ? AND user_id = ?",
        (event_id, g.user["id"]),
    )
    if event is None:
        abort(404)
    return event


def event_form_data():
    title = request.form.get("title", "").strip()
    event_date = request.form.get("event_date", "").strip()
    location = request.form.get("location", "").strip()
    description = request.form.get("description", "").strip()
    errors = []

    if not title:
        errors.append("Title is required.")
    if not event_date:
        errors.append("Date is required.")
    else:
        try:
            datetime.strptime(event_date, "%Y-%m-%d")
        except ValueError:
            errors.append("Date must use YYYY-MM-DD format.")
    if not location:
        errors.append("Location is required.")
    if not description:
        errors.append("Description is required.")

    return (
        {
            "title": title,
            "event_date": event_date,
            "location": location,
            "description": description,
        },
        errors,
    )


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5039, debug=True)
