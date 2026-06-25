import logging
import os
import sqlite3
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from functools import wraps

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
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
from flask_wtf import CSRFProtect, FlaskForm
from wtforms import DecimalField, PasswordField, SelectField, StringField, SubmitField
from wtforms.validators import DataRequired, Email, EqualTo, Length, NumberRange


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE_PATH = os.path.join(BASE_DIR, "app.db")

RATES_TO_USD = {
    "USD": Decimal("1.0000"),
    "EUR": Decimal("1.0800"),
    "GBP": Decimal("1.2700"),
    "JPY": Decimal("0.0064"),
    "CAD": Decimal("0.7300"),
    "AUD": Decimal("0.6600"),
    "CHF": Decimal("1.1100"),
}

CURRENCY_CHOICES = [(code, code) for code in sorted(RATES_TO_USD)]

ph = PasswordHasher()
csrf = CSRFProtect()


def create_app():
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        WTF_CSRF_TIME_LIMIT=3600,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "true").lower()
        == "true",
        SESSION_COOKIE_SAMESITE="Lax",
        MAX_CONTENT_LENGTH=16 * 1024,
    )

    csrf.init_app(app)
    logging.basicConfig(level=logging.INFO)

    @app.before_request
    def load_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is not None:
            g.user = query_one(
                "SELECT id, email FROM users WHERE id = ?",
                (user_id,),
            )

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self'; "
            "script-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        return response

    @app.errorhandler(400)
    def bad_request(_error):
        return render_template("error.html", message="The request could not be processed."), 400

    @app.errorhandler(403)
    def forbidden(_error):
        return render_template("error.html", message="You do not have permission to access this page."), 403

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", message="The page was not found."), 404

    @app.errorhandler(413)
    def payload_too_large(_error):
        return render_template("error.html", message="The submitted data is too large."), 413

    @app.errorhandler(500)
    def server_error(error):
        app.logger.exception("Unhandled server error: %s", error)
        return render_template("error.html", message="An internal error occurred."), 500

    @app.route("/", methods=["GET", "POST"])
    @login_required
    def converter():
        form = ConverterForm()
        result = None
        if form.validate_on_submit():
            amount = quantize_money(form.amount.data)
            source = form.source_currency.data
            target = form.target_currency.data
            result_amount = convert(amount, source, target)
            result = {
                "amount": amount,
                "source": source,
                "target": target,
                "converted": result_amount,
            }
            execute_db(
                """
                INSERT INTO conversions (user_id, amount, source_currency, target_currency, converted_amount)
                VALUES (?, ?, ?, ?, ?)
                """,
                (g.user["id"], str(amount), source, target, str(result_amount)),
            )
        return render_template("converter.html", form=form, result=result)

    @app.route("/history")
    @login_required
    def history():
        rows = query_all(
            """
            SELECT id, amount, source_currency, target_currency, converted_amount, created_at
            FROM conversions
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT 20
            """,
            (g.user["id"],),
        )
        return render_template("history.html", rows=rows)

    @app.route("/history/<int:conversion_id>/delete", methods=["POST"])
    @login_required
    def delete_conversion(conversion_id):
        row = query_one(
            "SELECT id, user_id FROM conversions WHERE id = ?",
            (conversion_id,),
        )
        if row is None:
            abort(404)
        if row["user_id"] != g.user["id"]:
            abort(403)
        execute_db(
            "DELETE FROM conversions WHERE id = ? AND user_id = ?",
            (conversion_id, g.user["id"]),
        )
        flash("Conversion deleted.", "success")
        return redirect(url_for("history"))

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if g.user:
            return redirect(url_for("converter"))
        form = RegisterForm()
        if form.validate_on_submit():
            email = normalize_email(form.email.data)
            existing = query_one("SELECT id FROM users WHERE email = ?", (email,))
            if existing:
                flash("An account with that email already exists.", "error")
                return render_template("register.html", form=form)
            password_hash = ph.hash(form.password.data)
            execute_db(
                "INSERT INTO users (email, password_hash) VALUES (?, ?)",
                (email, password_hash),
            )
            flash("Account created. Please sign in.", "success")
            return redirect(url_for("login"))
        return render_template("register.html", form=form)

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if g.user:
            return redirect(url_for("converter"))
        form = LoginForm()
        if form.validate_on_submit():
            email = normalize_email(form.email.data)
            user = query_one(
                "SELECT id, email, password_hash FROM users WHERE email = ?",
                (email,),
            )
            if user and verify_password(user["password_hash"], form.password.data):
                session.clear()
                session["user_id"] = user["id"]
                flash("Signed in.", "success")
                return redirect(url_for("converter"))
            flash("Invalid email or password.", "error")
        return render_template("login.html", form=form)

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        session.clear()
        flash("Signed out.", "success")
        return redirect(url_for("login"))

    @app.cli.command("init-db")
    def init_db_command():
        init_db()
        print("Initialized the database.")

    return app


class ConverterForm(FlaskForm):
    amount = DecimalField(
        "Amount",
        validators=[
            DataRequired(),
            NumberRange(min=Decimal("0.01"), max=Decimal("1000000000")),
        ],
        places=2,
    )
    source_currency = SelectField("From", choices=CURRENCY_CHOICES, validators=[DataRequired()])
    target_currency = SelectField("To", choices=CURRENCY_CHOICES, validators=[DataRequired()])
    submit = SubmitField("Convert")


class RegisterForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(min=12, max=128)])
    confirm_password = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Sign in")


def login_required(view):
    @wraps(view)
    def wrapped_view(**kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(**kwargs)

    return wrapped_view


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DATABASE_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    db = sqlite3.connect(DATABASE_PATH)
    try:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS conversions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount TEXT NOT NULL,
                source_currency TEXT NOT NULL,
                target_currency TEXT NOT NULL,
                converted_amount TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_conversions_user_id
            ON conversions (user_id);
            """
        )
        db.commit()
    finally:
        db.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def execute_db(sql, params=()):
    db = get_db()
    db.execute(sql, params)
    db.commit()


def normalize_email(value):
    return value.strip().lower()


def verify_password(stored_hash, password):
    try:
        return ph.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def quantize_money(value):
    if value is None:
        abort(400)
    try:
        return Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError):
        abort(400)


def convert(amount, source_currency, target_currency):
    if source_currency not in RATES_TO_USD or target_currency not in RATES_TO_USD:
        abort(400)
    usd_amount = amount * RATES_TO_USD[source_currency]
    converted = usd_amount / RATES_TO_USD[target_currency]
    return converted.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


app = create_app()
app.teardown_appcontext(close_db)

with app.app_context():
    init_db()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5017)
