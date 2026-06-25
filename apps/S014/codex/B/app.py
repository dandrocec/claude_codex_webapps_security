import os
import re
import secrets
import sqlite3
from datetime import timedelta
from functools import wraps

import bcrypt
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
from markupsafe import escape


QUOTES = [
    ("Act as if what you do makes a difference. It does.", "William James"),
    ("Start where you are. Use what you have. Do what you can.", "Arthur Ashe"),
    ("The future depends on what you do today.", "Mahatma Gandhi"),
    ("It always seems impossible until it is done.", "Nelson Mandela"),
    ("Quality is not an act, it is a habit.", "Aristotle"),
    ("Dream big and dare to fail.", "Norman Vaughan"),
    ("What you get by achieving your goals is not as important as what you become by achieving your goals.", "Zig Ziglar"),
    ("Believe you can and you're halfway there.", "Theodore Roosevelt"),
    ("Do not wait for the perfect moment; take the moment and make it perfect.", "Unknown"),
    ("The best way out is always through.", "Robert Frost"),
]

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        DATABASE=os.environ.get("DATABASE_PATH", os.path.join(app.instance_path, "quotes.sqlite3")),
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=2),
        MAX_CONTENT_LENGTH=16 * 1024,
    )

    os.makedirs(app.instance_path, exist_ok=True)

    @app.before_request
    def load_current_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            user = get_db().execute(
                "SELECT id, username FROM users WHERE id = ?",
                (user_id,),
            ).fetchone()
            if user is None:
                session.clear()
            else:
                g.user = user

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "img-src 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'; "
            "form-action 'self'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.is_secure:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.teardown_appcontext
    def close_db(error=None):
        db = g.pop("db", None)
        if db is not None:
            db.close()

    @app.context_processor
    def inject_csrf():
        return {"csrf_token": generate_csrf_token}

    @app.route("/")
    def index():
        return render_template("index.html", quote=random_quote())

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            validate_csrf_token()
            username = normalise_username(request.form.get("username", ""))
            password = request.form.get("password", "")

            if not username:
                flash("Use 3 to 32 letters, numbers, or underscores for the username.", "error")
                return render_template("register.html"), 400
            if len(password) < 12:
                flash("Password must be at least 12 characters.", "error")
                return render_template("register.html"), 400

            password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
            try:
                db = get_db()
                db.execute(
                    "INSERT INTO users (username, password_hash) VALUES (?, ?)",
                    (username, password_hash),
                )
                db.commit()
            except sqlite3.IntegrityError:
                flash("That username is already taken.", "error")
                return render_template("register.html"), 409

            flash("Account created. Sign in to save favorite quotes.", "success")
            return redirect(url_for("login"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            validate_csrf_token()
            username = normalise_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = None
            if username:
                user = get_db().execute(
                    "SELECT id, username, password_hash FROM users WHERE username = ?",
                    (username,),
                ).fetchone()

            if user is None or not bcrypt.checkpw(password.encode("utf-8"), user["password_hash"].encode("utf-8")):
                flash("Invalid username or password.", "error")
                return render_template("login.html"), 401

            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            flash("Signed in.", "success")
            return redirect(url_for("favorites"))

        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    def logout():
        validate_csrf_token()
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("index"))

    @app.route("/favorites", methods=["GET"])
    @login_required
    def favorites():
        rows = get_db().execute(
            "SELECT id, quote, author FROM favorites WHERE user_id = ? ORDER BY id DESC",
            (g.user["id"],),
        ).fetchall()
        return render_template("favorites.html", favorites=rows)

    @app.route("/favorites", methods=["POST"])
    @login_required
    def save_favorite():
        validate_csrf_token()
        quote = clean_text(request.form.get("quote", ""), 240)
        author = clean_text(request.form.get("author", ""), 80)
        if not quote or not author:
            abort(400)
        if (quote, author) not in QUOTES:
            abort(400)

        db = get_db()
        db.execute(
            "INSERT INTO favorites (user_id, quote, author) VALUES (?, ?, ?)",
            (g.user["id"], quote, author),
        )
        db.commit()
        flash("Quote saved.", "success")
        return redirect(url_for("favorites"))

    @app.route("/favorites/<int:favorite_id>/delete", methods=["POST"])
    @login_required
    def delete_favorite(favorite_id):
        validate_csrf_token()
        db = get_db()
        favorite = db.execute(
            "SELECT id FROM favorites WHERE id = ? AND user_id = ?",
            (favorite_id, g.user["id"]),
        ).fetchone()
        if favorite is None:
            abort(404)
        db.execute(
            "DELETE FROM favorites WHERE id = ? AND user_id = ?",
            (favorite_id, g.user["id"]),
        )
        db.commit()
        flash("Favorite removed.", "success")
        return redirect(url_for("favorites"))

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(500)
    def error_page(error):
        status_code = getattr(error, "code", 500)
        if status_code == 500:
            app.logger.exception("Unhandled application error")
        messages = {
            400: "The request could not be processed.",
            403: "The request was not allowed.",
            404: "The requested page was not found.",
            413: "The request was too large.",
            500: "An internal error occurred.",
        }
        return render_template("error.html", message=messages.get(status_code, "An error occurred.")), status_code

    with app.app_context():
        init_db()

    return app


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app_config("DATABASE"),
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
    return g.db


def current_app_config(name):
    from flask import current_app

    return current_app.config[name]


def init_db():
    db = get_db()
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            quote TEXT NOT NULL,
            author TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
        """
    )
    db.commit()


def random_quote():
    return secrets.choice(QUOTES)


def normalise_username(value):
    username = clean_text(value, 32)
    if USERNAME_RE.fullmatch(username):
        return username
    return ""


def clean_text(value, max_length):
    if not isinstance(value, str):
        return ""
    cleaned = value.strip()
    if len(cleaned) > max_length:
        return ""
    return str(escape(cleaned))


def generate_csrf_token():
    token = session.get("csrf_token")
    if token is None:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def validate_csrf_token():
    expected = session.get("csrf_token")
    supplied = request.form.get("csrf_token", "")
    if not expected or not secrets.compare_digest(expected, supplied):
        abort(403)


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5014)
