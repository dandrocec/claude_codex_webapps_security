import os
import re
import sqlite3
import secrets
from datetime import datetime, timezone
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


BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DATABASE_PATH = os.environ.get("LEDGER_DATABASE", os.path.join(BASE_DIR, "ledger.sqlite3"))
USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
PASSWORD_MIN_LENGTH = 12
MAX_TRANSFER_CENTS = 1_000_000_00

ph = PasswordHasher()


def create_app():
    secret_key = os.environ.get("LEDGER_SECRET_KEY")
    if not secret_key:
        raise RuntimeError("LEDGER_SECRET_KEY must be set before starting the app.")

    app = Flask(__name__)
    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("LEDGER_COOKIE_SECURE", "1") != "0",
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=1800,
        MAX_CONTENT_LENGTH=32 * 1024,
    )

    @app.before_request
    def load_current_user():
        g.user = None
        user_id = session.get("user_id")
        if user_id is None:
            return
        user = query_one(
            "SELECT id, username, balance_cents FROM users WHERE id = ?",
            (user_id,),
        )
        if user is None:
            session.clear()
            return
        g.user = user

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "form-action 'self'; "
            "base-uri 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.context_processor
    def template_helpers():
        return {
            "csrf_token": csrf_token,
            "format_money": format_money,
        }

    @app.route("/")
    def index():
        if g.user:
            return redirect(url_for("dashboard"))
        return render_template("index.html")

    @app.route("/register", methods=["GET", "POST"])
    def register():
        if request.method == "POST":
            require_csrf()
            username = normalize_username(request.form.get("username", ""))
            password = request.form.get("password", "")

            if not USERNAME_RE.fullmatch(username):
                flash("Use 3 to 32 letters, numbers, or underscores for the username.")
                return render_template("register.html"), 400
            if len(password) < PASSWORD_MIN_LENGTH:
                flash("Use a password of at least 12 characters.")
                return render_template("register.html"), 400

            password_hash = ph.hash(password)
            try:
                with get_db() as db:
                    db.execute(
                        "INSERT INTO users (username, password_hash, balance_cents) VALUES (?, ?, ?)",
                        (username, password_hash, 100_00),
                    )
            except sqlite3.IntegrityError:
                flash("That username is already taken.")
                return render_template("register.html"), 409

            flash("Account created. Sign in to continue.")
            return redirect(url_for("login"))

        return render_template("register.html")

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if request.method == "POST":
            require_csrf()
            username = normalize_username(request.form.get("username", ""))
            password = request.form.get("password", "")
            user = query_one(
                "SELECT id, username, password_hash FROM users WHERE username = ?",
                (username,),
            )

            valid = False
            if user:
                try:
                    valid = ph.verify(user["password_hash"], password)
                except (VerifyMismatchError, VerificationError):
                    valid = False

            if not valid:
                flash("Invalid username or password.")
                return render_template("login.html"), 401

            session.clear()
            session.permanent = True
            session["user_id"] = user["id"]
            session["csrf_token"] = secrets.token_urlsafe(32)
            return redirect(url_for("dashboard"))

        return render_template("login.html")

    @app.route("/logout", methods=["POST"])
    @login_required
    def logout():
        require_csrf()
        session.clear()
        return redirect(url_for("index"))

    @app.route("/dashboard")
    @login_required
    def dashboard():
        transactions = get_transactions_for_user(g.user["id"])
        return render_template("dashboard.html", transactions=transactions)

    @app.route("/transfer", methods=["GET", "POST"])
    @login_required
    def transfer():
        if request.method == "POST":
            require_csrf()
            recipient_name = normalize_username(request.form.get("recipient", ""))
            amount_text = request.form.get("amount", "")
            memo = sanitize_memo(request.form.get("memo", ""))

            if not USERNAME_RE.fullmatch(recipient_name):
                flash("Enter a valid recipient username.")
                return render_template("transfer.html"), 400

            try:
                amount_cents = parse_money_to_cents(amount_text)
            except ValueError as exc:
                flash(str(exc))
                return render_template("transfer.html"), 400

            if amount_cents > MAX_TRANSFER_CENTS:
                flash("Transfer amount is above the allowed limit.")
                return render_template("transfer.html"), 400

            try:
                make_transfer(g.user["id"], recipient_name, amount_cents, memo)
            except TransferError as exc:
                flash(str(exc))
                return render_template("transfer.html"), 400

            flash("Transfer recorded.")
            return redirect(url_for("dashboard"))

        return render_template("transfer.html")

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(500)
    def handle_error(error):
        status_code = getattr(error, "code", 500)
        message = "The request could not be completed."
        if status_code == 404:
            message = "The requested page was not found."
        elif status_code == 413:
            message = "The request was too large."
        return render_template("error.html", message=message), status_code

    init_db()
    return app


def get_db():
    if "db" not in g:
        db = sqlite3.connect(DATABASE_PATH, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA busy_timeout = 5000")
        g.db = db
    return g.db


def close_db(_error=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    database_dir = os.path.dirname(os.path.abspath(DATABASE_PATH))
    os.makedirs(database_dir, exist_ok=True)
    db = sqlite3.connect(DATABASE_PATH)
    try:
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                balance_cents INTEGER NOT NULL CHECK (balance_cents >= 0),
                created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_id INTEGER NOT NULL,
                recipient_id INTEGER NOT NULL,
                amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
                memo TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                FOREIGN KEY (sender_id) REFERENCES users(id),
                FOREIGN KEY (recipient_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_sender ON transactions(sender_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_transactions_recipient ON transactions(recipient_id, created_at DESC);

            CREATE TRIGGER IF NOT EXISTS prevent_transaction_update
            BEFORE UPDATE ON transactions
            BEGIN
                SELECT RAISE(ABORT, 'transactions are immutable');
            END;

            CREATE TRIGGER IF NOT EXISTS prevent_transaction_delete
            BEFORE DELETE ON transactions
            BEGIN
                SELECT RAISE(ABORT, 'transactions are immutable');
            END;
            """
        )
        db.commit()
    finally:
        db.close()


def query_one(sql, params=()):
    return get_db().execute(sql, params).fetchone()


def query_all(sql, params=()):
    return get_db().execute(sql, params).fetchall()


def login_required(view):
    @wraps(view)
    def wrapped_view(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login"))
        return view(*args, **kwargs)

    return wrapped_view


def csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def require_csrf():
    session_token = session.get("csrf_token")
    form_token = request.form.get("csrf_token", "")
    if not session_token or not secrets.compare_digest(session_token, form_token):
        abort(403)


def normalize_username(value):
    return value.strip()


def sanitize_memo(value):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value.strip())[:160]


def parse_money_to_cents(value):
    try:
        amount = Decimal(value.strip())
    except (AttributeError, InvalidOperation):
        raise ValueError("Enter a valid amount.")

    if amount <= 0:
        raise ValueError("Transfer amount must be greater than zero.")
    quantized = amount.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if quantized != amount:
        raise ValueError("Use at most two decimal places.")
    return int(quantized * 100)


def format_money(cents):
    return f"${Decimal(cents) / Decimal(100):,.2f}"


class TransferError(Exception):
    pass


def make_transfer(sender_id, recipient_name, amount_cents, memo):
    db = get_db()
    try:
        db.execute("BEGIN IMMEDIATE")
        sender = db.execute(
            "SELECT id, balance_cents FROM users WHERE id = ?",
            (sender_id,),
        ).fetchone()
        recipient = db.execute(
            "SELECT id FROM users WHERE username = ?",
            (recipient_name,),
        ).fetchone()

        if sender is None:
            raise TransferError("Sender account was not found.")
        if recipient is None:
            raise TransferError("Recipient account was not found.")
        if recipient["id"] == sender["id"]:
            raise TransferError("You cannot transfer funds to yourself.")
        if sender["balance_cents"] < amount_cents:
            raise TransferError("Insufficient funds.")

        updated = db.execute(
            """
            UPDATE users
            SET balance_cents = balance_cents - ?
            WHERE id = ? AND balance_cents >= ?
            """,
            (amount_cents, sender["id"], amount_cents),
        )
        if updated.rowcount != 1:
            raise TransferError("Insufficient funds.")

        db.execute(
            "UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?",
            (amount_cents, recipient["id"]),
        )
        db.execute(
            """
            INSERT INTO transactions (sender_id, recipient_id, amount_cents, memo, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                sender["id"],
                recipient["id"],
                amount_cents,
                memo,
                datetime.now(timezone.utc).isoformat(timespec="seconds"),
            ),
        )
        db.execute("COMMIT")
    except Exception:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise


def get_transactions_for_user(user_id):
    return query_all(
        """
        SELECT
            t.id,
            t.amount_cents,
            t.memo,
            t.created_at,
            sender.username AS sender_username,
            recipient.username AS recipient_username,
            CASE WHEN t.sender_id = ? THEN 'sent' ELSE 'received' END AS direction
        FROM transactions AS t
        JOIN users AS sender ON sender.id = t.sender_id
        JOIN users AS recipient ON recipient.id = t.recipient_id
        WHERE t.sender_id = ? OR t.recipient_id = ?
        ORDER BY t.created_at DESC, t.id DESC
        LIMIT 100
        """,
        (user_id, user_id, user_id),
    )


app = create_app()
app.teardown_appcontext(close_db)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5093, debug=False)
