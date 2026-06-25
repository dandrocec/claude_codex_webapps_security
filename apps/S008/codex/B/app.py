import base64
import io
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from functools import wraps
from urllib.parse import urlparse

import qrcode
from flask import (
    Flask,
    abort,
    flash,
    g,
    make_response,
    redirect,
    render_template,
    request,
    send_file,
    session,
    url_for,
)
from flask_bcrypt import Bcrypt
from flask_wtf import CSRFProtect, FlaskForm
from wtforms import PasswordField, StringField, TextAreaField
from wtforms.validators import DataRequired, EqualTo, Length, ValidationError


DATABASE_PATH = os.environ.get("DATABASE_PATH", os.path.join(os.path.dirname(__file__), "instance", "app.db"))
MAX_QR_INPUT_LENGTH = 2048
URL_SCHEMES = {"http", "https"}

app = Flask(__name__)
app.config.update(
    SECRET_KEY=os.environ.get("SECRET_KEY") or secrets.token_urlsafe(48),
    WTF_CSRF_TIME_LIMIT=3600,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower() == "true",
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=16 * 1024,
)

bcrypt = Bcrypt(app)
csrf = CSRFProtect(app)


class RegisterForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(min=3, max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=12, max=128)])
    confirm_password = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )

    def validate_username(self, field):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+", field.data):
            raise ValidationError("Use letters, numbers, dots, dashes, or underscores only.")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(min=3, max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=1, max=128)])


class QRForm(FlaskForm):
    qr_text = TextAreaField("Text or URL", validators=[DataRequired(), Length(min=1, max=MAX_QR_INPUT_LENGTH)])

    def validate_qr_text(self, field):
        value = normalize_qr_input(field.data)
        parsed = urlparse(value)
        if parsed.scheme and parsed.scheme.lower() not in URL_SCHEMES:
            raise ValidationError("Only http and https URLs are accepted.")
        if parsed.scheme and not parsed.netloc:
            raise ValidationError("Enter a complete URL with a host name.")


def get_db():
    if "db" not in g:
        os.makedirs(os.path.dirname(DATABASE_PATH), exist_ok=True)
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
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
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS qr_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );
        """
    )
    db.commit()


@app.before_request
def prepare_request():
    init_db()
    g.user = None
    user_id = session.get("user_id")
    if user_id:
        g.user = query_one("SELECT id, username FROM users WHERE id = ?", (user_id,))
        if g.user is None:
            session.clear()


@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if request.is_secure or app.config["SESSION_COOKIE_SECURE"]:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute(sql, params=()):
    db = get_db()
    cursor = db.execute(sql, params)
    db.commit()
    return cursor


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            flash("Sign in to continue.", "warning")
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def normalize_qr_input(value):
    return " ".join(value.replace("\x00", "").strip().split())


def generate_qr_png(content):
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(content)
    qr.make(fit=True)
    image = qr.make_image(fill_color="black", back_color="white")
    output = io.BytesIO()
    image.save(output, format="PNG")
    output.seek(0)
    return output


def qr_data_uri(content):
    image = generate_qr_png(content)
    encoded = base64.b64encode(image.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def current_timestamp():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def password_is_strong(password):
    return (
        len(password) >= 12
        and re.search(r"[a-z]", password)
        and re.search(r"[A-Z]", password)
        and re.search(r"\d", password)
    )


@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(500)
def error_page(error):
    status_code = getattr(error, "code", 500)
    message = {
        400: "The request could not be processed.",
        403: "You do not have access to that resource.",
        404: "The requested page was not found.",
        413: "The submitted content is too large.",
    }.get(status_code, "An unexpected error occurred.")
    return render_template("error.html", status_code=status_code, message=message), status_code


@app.route("/")
def index():
    if g.user:
        return redirect(url_for("dashboard"))
    return render_template("index.html")


@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("dashboard"))
    form = RegisterForm()
    if form.validate_on_submit():
        username = form.username.data.strip()
        if not password_is_strong(form.password.data):
            flash("Password must include uppercase, lowercase, and a number.", "danger")
            return render_template("register.html", form=form)
        if query_one("SELECT id FROM users WHERE username = ?", (username,)):
            flash("That username is already taken.", "danger")
            return render_template("register.html", form=form)

        password_hash = bcrypt.generate_password_hash(form.password.data).decode("utf-8")
        user_id = execute(
            "INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, password_hash, current_timestamp()),
        ).lastrowid
        session.clear()
        session["user_id"] = user_id
        session.permanent = True
        return redirect(url_for("dashboard"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("dashboard"))
    form = LoginForm()
    if form.validate_on_submit():
        user = query_one("SELECT id, password_hash FROM users WHERE username = ?", (form.username.data.strip(),))
        if user and bcrypt.check_password_hash(user["password_hash"], form.password.data):
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            return redirect(url_for("dashboard"))
        flash("Invalid username or password.", "danger")
    return render_template("login.html", form=form)


@app.post("/logout")
@login_required
def logout():
    session.clear()
    flash("You have been signed out.", "info")
    return redirect(url_for("index"))


@app.route("/dashboard")
@login_required
def dashboard():
    form = QRForm()
    qrs = query_all(
        "SELECT id, content, created_at FROM qr_codes WHERE user_id = ? ORDER BY id DESC LIMIT 10",
        (g.user["id"],),
    )
    return render_template("dashboard.html", form=form, qrs=qrs)


@app.post("/qr")
@login_required
def create_qr():
    form = QRForm()
    if not form.validate_on_submit():
        for errors in form.errors.values():
            for error in errors:
                flash(error, "danger")
        return redirect(url_for("dashboard"))

    content = normalize_qr_input(form.qr_text.data)
    qr_id = execute(
        "INSERT INTO qr_codes (user_id, content, created_at) VALUES (?, ?, ?)",
        (g.user["id"], content, current_timestamp()),
    ).lastrowid
    return redirect(url_for("qr_result", qr_id=qr_id))


@app.route("/qr/<int:qr_id>")
@login_required
def qr_result(qr_id):
    qr = query_one(
        "SELECT id, content, created_at FROM qr_codes WHERE id = ? AND user_id = ?",
        (qr_id, g.user["id"]),
    )
    if qr is None:
        abort(404)
    return render_template("result.html", qr=qr, image_uri=qr_data_uri(qr["content"]))


@app.route("/qr/<int:qr_id>/download")
@login_required
def download_qr(qr_id):
    qr = query_one(
        "SELECT id, content FROM qr_codes WHERE id = ? AND user_id = ?",
        (qr_id, g.user["id"]),
    )
    if qr is None:
        abort(404)
    response = make_response(
        send_file(
            generate_qr_png(qr["content"]),
            mimetype="image/png",
            as_attachment=True,
            download_name=f"qr-code-{qr['id']}.png",
        )
    )
    response.headers["Cache-Control"] = "no-store"
    return response


@app.template_filter("truncate_middle")
def truncate_middle(value, length=90):
    value = str(value)
    if len(value) <= length:
        return value
    side = (length - 3) // 2
    return f"{value[:side]}...{value[-side:]}"


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5008")), debug=False)
