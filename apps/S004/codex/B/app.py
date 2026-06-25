import os
import sqlite3
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
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
from flask_bcrypt import Bcrypt
from flask_wtf import CSRFProtect
from markupsafe import escape
from wtforms import DecimalField, PasswordField, RadioField, StringField, SubmitField
from wtforms.validators import DataRequired, Email, Length, NumberRange
from flask_wtf import FlaskForm


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "app.db"))


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY")
    WTF_CSRF_TIME_LIMIT = 3600
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("SESSION_COOKIE_SECURE", "true").lower() == "true"
    MAX_CONTENT_LENGTH = 16 * 1024


class ConversionForm(FlaskForm):
    value = DecimalField(
        "Temperature",
        places=4,
        validators=[DataRequired(), NumberRange(min=-1000, max=1000)],
    )
    direction = RadioField(
        "Direction",
        choices=[
            ("c_to_f", "Celsius to Fahrenheit"),
            ("f_to_c", "Fahrenheit to Celsius"),
        ],
        validators=[DataRequired()],
    )
    submit = SubmitField("Convert")


class RegisterForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=12, max=128)])
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Sign in")


app = Flask(__name__)
app.config.from_object(Config)

if not app.config["SECRET_KEY"]:
    if os.environ.get("FLASK_ENV") == "production":
        raise RuntimeError("SECRET_KEY must be set in production.")
    app.config["SECRET_KEY"] = os.urandom(32)

bcrypt = Bcrypt(app)
csrf = CSRFProtect(app)


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
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS conversions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            input_value TEXT NOT NULL,
            direction TEXT NOT NULL,
            output_value TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
        """
    )
    db.commit()


with app.app_context():
    init_db()


@app.before_request
def load_current_user():
    g.user = None
    user_id = session.get("user_id")
    if user_id is not None:
        g.user = get_db().execute(
            "SELECT id, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()


@app.after_request
def set_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "style-src 'self' 'unsafe-inline'; "
        "base-uri 'self'; "
        "frame-ancestors 'none'; "
        "form-action 'self'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    response.headers["Cache-Control"] = "no-store"
    if request.is_secure:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            flash("Please sign in to view that page.", "warning")
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def convert_temperature(value, direction):
    try:
        temp = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError("Enter a valid temperature.")

    if direction == "c_to_f":
        result = (temp * Decimal("9") / Decimal("5")) + Decimal("32")
        label = "F"
    elif direction == "f_to_c":
        result = (temp - Decimal("32")) * Decimal("5") / Decimal("9")
        label = "C"
    else:
        raise ValueError("Choose a valid conversion direction.")

    rounded = result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return rounded, label


@app.route("/", methods=["GET", "POST"])
def index():
    form = ConversionForm()
    result = None

    if form.validate_on_submit():
        converted, unit = convert_temperature(form.value.data, form.direction.data)
        result = f"{converted} °{unit}"

        if g.user is not None:
            get_db().execute(
                """
                INSERT INTO conversions (user_id, input_value, direction, output_value)
                VALUES (?, ?, ?, ?)
                """,
                (g.user["id"], str(form.value.data), form.direction.data, result),
            )
            get_db().commit()

    return render_template("index.html", form=form, result=result)


@app.route("/register", methods=["GET", "POST"])
def register():
    form = RegisterForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        password_hash = bcrypt.generate_password_hash(form.password.data).decode("utf-8")
        try:
            cursor = get_db().execute(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, password_hash),
            )
            get_db().commit()
        except sqlite3.IntegrityError:
            flash("An account with that email already exists.", "error")
        else:
            session.clear()
            session["user_id"] = cursor.lastrowid
            session.permanent = True
            return redirect(url_for("index"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    form = LoginForm()
    if form.validate_on_submit():
        email = form.email.data.strip().lower()
        user = get_db().execute(
            "SELECT id, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()
        if user and bcrypt.check_password_hash(user["password_hash"], form.password.data):
            session.clear()
            session["user_id"] = user["id"]
            session.permanent = True
            return redirect(url_for("index"))
        flash("Invalid email or password.", "error")
    return render_template("login.html", form=form)


@app.route("/logout", methods=["POST"])
@login_required
def logout():
    session.clear()
    return redirect(url_for("index"))


@app.route("/history")
@login_required
def history():
    rows = get_db().execute(
        """
        SELECT id, input_value, direction, output_value, created_at
        FROM conversions
        WHERE user_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 25
        """,
        (g.user["id"],),
    ).fetchall()
    return render_template("history.html", rows=rows)


@app.route("/history/<int:conversion_id>/delete", methods=["POST"])
@login_required
def delete_history_item(conversion_id):
    row = get_db().execute(
        "SELECT id FROM conversions WHERE id = ? AND user_id = ?",
        (conversion_id, g.user["id"]),
    ).fetchone()
    if row is None:
        abort(404)

    get_db().execute(
        "DELETE FROM conversions WHERE id = ? AND user_id = ?",
        (conversion_id, g.user["id"]),
    )
    get_db().commit()
    return redirect(url_for("history"))


@app.errorhandler(400)
@app.errorhandler(403)
@app.errorhandler(404)
@app.errorhandler(413)
@app.errorhandler(500)
def handle_error(error):
    status_code = getattr(error, "code", 500)
    return render_template("error.html", status_code=status_code), status_code


@app.template_filter("direction_label")
def direction_label(value):
    labels = {
        "c_to_f": "Celsius to Fahrenheit",
        "f_to_c": "Fahrenheit to Celsius",
    }
    return labels.get(escape(value), "Unknown")


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5004)
