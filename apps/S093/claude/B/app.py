"""A small, security-hardened Flask ledger application.

Users register, log in, and transfer funds to one another. Every transfer is
recorded as an immutable transaction and balances are updated atomically inside
a single database transaction guarded so a balance can never go negative.

Security notes are inline next to the relevant code.
"""

import os
import re
import secrets
import sqlite3
from functools import wraps

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
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
from flask_wtf import FlaskForm
from flask_wtf.csrf import CSRFProtect
from wtforms import DecimalField, PasswordField, StringField
from wtforms.validators import (
    DataRequired,
    Length,
    NumberRange,
    Optional,
    Regexp,
    ValidationError,
)

import db

# --------------------------------------------------------------------------- #
# App + configuration
# --------------------------------------------------------------------------- #

app = Flask(__name__)

# Secrets are never hardcoded. A missing key in development falls back to a
# random ephemeral key (sessions reset on restart) and logs a warning; in
# production SECRET_KEY must be set.
_secret = os.environ.get("SECRET_KEY")
if not _secret:
    _secret = secrets.token_hex(32)
    app.logger.warning(
        "SECRET_KEY not set; using a random ephemeral key. "
        "Set SECRET_KEY in the environment for stable sessions."
    )

# SECURE_COOKIES defaults to on. Set SECURE_COOKIES=false only for local HTTP
# testing, where a Secure-flagged cookie would otherwise never be sent.
_secure_cookies = os.environ.get("SECURE_COOKIES", "true").lower() != "false"

app.config.update(
    SECRET_KEY=_secret,
    SESSION_COOKIE_HTTPONLY=True,       # JS cannot read the session cookie
    SESSION_COOKIE_SAMESITE="Lax",      # mitigates CSRF on top-level navigations
    SESSION_COOKIE_SECURE=_secure_cookies,  # cookie only sent over HTTPS
    WTF_CSRF_TIME_LIMIT=None,
    MAX_CONTENT_LENGTH=64 * 1024,       # reject oversized request bodies
)

csrf = CSRFProtect(app)   # CSRF token required on every state-changing POST
db.init_app(app)

# Argon2id is a strong, salted password hash. The PasswordHasher generates a
# unique random salt per password automatically.
ph = PasswordHasher()
# A real hash used to equalize work (and timing) when a username doesn't exist,
# so login response time doesn't reveal whether an account is present.
_DUMMY_HASH = ph.hash("dummy-password-for-timing-equalization")

USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,32}$")
MAX_AMOUNT_CENTS = 1_000_000_000  # ceiling guards against absurd inputs/overflow


# --------------------------------------------------------------------------- #
# Forms (server-side validation; WTForms also drives CSRF tokens in templates)
# --------------------------------------------------------------------------- #

class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Regexp(
                USERNAME_RE,
                message="3-32 characters: letters, numbers, and underscores only.",
            ),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=8, max=128)],
    )


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])


class TransferForm(FlaskForm):
    recipient = StringField(
        "Recipient username",
        validators=[DataRequired(), Regexp(USERNAME_RE, message="Invalid username.")],
    )
    amount = DecimalField(
        "Amount",
        places=2,
        validators=[DataRequired(), NumberRange(min=0.01, message="Amount must be positive.")],
    )
    memo = StringField("Memo (optional)", validators=[Optional(), Length(max=140)])

    def validate_amount(self, field):
        # Reject sub-cent precision and enforce the upper ceiling.
        cents = (field.data * 100)
        if cents != cents.to_integral_value():
            raise ValidationError("Amount cannot have fractions of a cent.")
        if int(cents) > MAX_AMOUNT_CENTS:
            raise ValidationError("Amount exceeds the maximum allowed.")


# --------------------------------------------------------------------------- #
# Auth helpers
# --------------------------------------------------------------------------- #

def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


@app.before_request
def load_current_user():
    """Resolve the logged-in user from the session for each request."""
    g.user = None
    uid = session.get("user_id")
    if uid is not None:
        row = db.get_db().execute(
            "SELECT id, username, balance_cents FROM users WHERE id = ?", (uid,)
        ).fetchone()
        if row is None:
            session.clear()
        else:
            g.user = row


# --------------------------------------------------------------------------- #
# Security headers
# --------------------------------------------------------------------------- #

@app.after_request
def set_security_headers(resp):
    # A strict CSP: only same-origin resources; no inline scripts. Combined with
    # Jinja2 auto-escaping this gives strong XSS defense in depth.
    resp.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self'; object-src 'none'; base-uri 'none'; "
        "form-action 'self'; frame-ancestors 'none'"
    )
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
    if app.config["SESSION_COOKIE_SECURE"]:
        resp.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )
    return resp


# --------------------------------------------------------------------------- #
# Money formatting helper (exposed to templates)
# --------------------------------------------------------------------------- #

@app.template_filter("money")
def money(cents):
    return f"{cents / 100:,.2f}"


# --------------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------------- #

@app.route("/")
def index():
    if g.user:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))


@app.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(url_for("dashboard"))
    form = RegisterForm()
    if form.validate_on_submit():
        username = form.username.data
        pw_hash = ph.hash(form.password.data)
        try:
            cur = db.get_db().execute(
                "INSERT INTO users (username, password_hash, balance_cents) "
                "VALUES (?, ?, ?)",
                (username, pw_hash, 10000),  # seed each new account with $100.00
            )
        except sqlite3.IntegrityError:
            # UNIQUE violation -> username taken. Same generic message either way.
            flash("That username is not available.", "error")
        else:
            session.clear()
            session["user_id"] = cur.lastrowid
            flash("Account created. You start with a $100.00 demo balance.", "ok")
            return redirect(url_for("dashboard"))
    return render_template("register.html", form=form)


@app.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(url_for("dashboard"))
    form = LoginForm()
    if form.validate_on_submit():
        row = db.get_db().execute(
            "SELECT id, password_hash FROM users WHERE username = ?",
            (form.username.data,),
        ).fetchone()

        # Verify against the stored hash. We always run a verification path to
        # keep timing roughly constant whether or not the user exists.
        valid = False
        if row is not None:
            try:
                ph.verify(row["password_hash"], form.password.data)
                valid = True
            except (VerifyMismatchError, VerificationError, InvalidHashError):
                valid = False
        else:
            # Dummy verify to avoid leaking user existence via response time.
            try:
                ph.verify(_DUMMY_HASH, form.password.data)
            except Exception:
                pass

        if valid:
            # Rotate the session ID on privilege change to prevent fixation.
            session.clear()
            session["user_id"] = row["id"]
            # Transparently upgrade the hash if parameters have changed.
            if ph.check_needs_rehash(row["password_hash"]):
                db.get_db().execute(
                    "UPDATE users SET password_hash = ? WHERE id = ?",
                    (ph.hash(form.password.data), row["id"]),
                )
            nxt = request.args.get("next", "")
            return redirect(_safe_next(nxt) or url_for("dashboard"))
        flash("Invalid username or password.", "error")
    return render_template("login.html", form=form)


@app.route("/logout", methods=["POST"])
def logout():
    session.clear()
    flash("You have been logged out.", "ok")
    return redirect(url_for("login"))


@app.route("/dashboard")
@login_required
def dashboard():
    form = TransferForm()
    return render_template("dashboard.html", form=form)


@app.route("/transfer", methods=["POST"])
@login_required
def transfer():
    form = TransferForm()
    if not form.validate_on_submit():
        for errors in form.errors.values():
            for err in errors:
                flash(err, "error")
        return redirect(url_for("dashboard"))

    sender_id = g.user["id"]
    amount_cents = int(form.amount.data * 100)
    recipient_name = form.recipient.data
    memo = form.memo.data or ""

    conn = db.get_db()
    recipient = conn.execute(
        "SELECT id FROM users WHERE username = ?", (recipient_name,)
    ).fetchone()
    if recipient is None:
        flash("Recipient not found.", "error")
        return redirect(url_for("dashboard"))
    if recipient["id"] == sender_id:
        flash("You cannot transfer funds to yourself.", "error")
        return redirect(url_for("dashboard"))

    # Atomic transfer. BEGIN IMMEDIATE takes a write lock up front so two
    # concurrent transfers can't interleave. The debit only succeeds when the
    # sender has sufficient funds (WHERE balance_cents >= amount); if not, the
    # UPDATE affects 0 rows and we roll back. The CHECK constraint in the schema
    # is a final backstop against a negative balance.
    try:
        conn.execute("BEGIN IMMEDIATE")
        debit = conn.execute(
            "UPDATE users SET balance_cents = balance_cents - ? "
            "WHERE id = ? AND balance_cents >= ?",
            (amount_cents, sender_id, amount_cents),
        )
        if debit.rowcount != 1:
            conn.execute("ROLLBACK")
            flash("Insufficient funds for that transfer.", "error")
            return redirect(url_for("dashboard"))

        conn.execute(
            "UPDATE users SET balance_cents = balance_cents + ? WHERE id = ?",
            (amount_cents, recipient["id"]),
        )
        conn.execute(
            "INSERT INTO transactions (sender_id, recipient_id, amount_cents, memo) "
            "VALUES (?, ?, ?, ?)",
            (sender_id, recipient["id"], amount_cents, memo),
        )
        conn.execute("COMMIT")
    except sqlite3.Error:
        conn.execute("ROLLBACK")
        # Don't leak internal errors to the client.
        app.logger.exception("Transfer failed")
        flash("The transfer could not be completed. Please try again.", "error")
        return redirect(url_for("dashboard"))

    flash(f"Sent ${amount_cents / 100:,.2f} to {recipient_name}.", "ok")
    return redirect(url_for("history"))


@app.route("/history")
@login_required
def history():
    # Access control: the query is scoped to the current user's id taken from
    # the session, so a user can only ever see their own transactions (no IDOR).
    uid = g.user["id"]
    rows = db.get_db().execute(
        """
        SELECT t.id, t.amount_cents, t.memo, t.created_at,
               t.sender_id, t.recipient_id,
               su.username AS sender_name,
               ru.username AS recipient_name
        FROM transactions t
        JOIN users su ON su.id = t.sender_id
        JOIN users ru ON ru.id = t.recipient_id
        WHERE t.sender_id = ? OR t.recipient_id = ?
        ORDER BY t.id DESC
        LIMIT 200
        """,
        (uid, uid),
    ).fetchall()
    return render_template("history.html", rows=rows, uid=uid)


# --------------------------------------------------------------------------- #
# Helpers + error handlers
# --------------------------------------------------------------------------- #

def _safe_next(target):
    """Allow only local, same-app redirect targets (prevents open redirect)."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return None


@app.errorhandler(404)
def not_found(_e):
    return render_template("error.html", code=404, message="Page not found."), 404


@app.errorhandler(400)
def bad_request(_e):
    return render_template("error.html", code=400, message="Bad request."), 400


@app.errorhandler(500)
def server_error(_e):
    # Generic message only; details go to the server log, never to the client.
    return render_template("error.html", code=500, message="Something went wrong."), 500


if __name__ == "__main__":
    db.init_db()
    # debug must stay False so stack traces are never shown to clients.
    app.run(host="127.0.0.1", port=5093, debug=False)
