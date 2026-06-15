"""A small, security-conscious Flask currency converter.

The app exposes a single form: enter an amount, pick a source and target
currency from a fixed list, and submit to see the converted value. Rates are
hard-coded (this is a demo, not a live FX service).

Security posture is documented per-control in the README. In short: this app
has no database and no user accounts, so the SQL-injection, password-hashing
and IDOR controls from the brief do not have an attack surface here. Everything
that *does* apply (input validation, CSRF, output encoding, secure cookies,
security headers, no error leakage, secrets from the environment) is enforced
below.
"""

from __future__ import annotations

import os
import secrets
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

from flask import Flask, render_template, request
from flask_wtf import FlaskForm, CSRFProtect
from flask_wtf.csrf import CSRFError
from wtforms import DecimalField, SelectField
from wtforms.validators import DataRequired, NumberRange, AnyOf

# --- Static reference data ---------------------------------------------------
# Rates are expressed relative to 1 USD. Converting A -> B is:
#   amount_in_B = amount_in_A / rate[A] * rate[B]
# Keeping a single base avoids maintaining an NxN matrix and keeps the math
# auditable.
RATES: dict[str, Decimal] = {
    "USD": Decimal("1.00"),
    "EUR": Decimal("0.92"),
    "GBP": Decimal("0.79"),
    "JPY": Decimal("157.20"),
    "CAD": Decimal("1.37"),
    "AUD": Decimal("1.52"),
    "CHF": Decimal("0.90"),
    "CNY": Decimal("7.24"),
    "INR": Decimal("83.40"),
    "BRL": Decimal("5.43"),
}

CURRENCY_CODES = tuple(RATES.keys())
CURRENCY_CHOICES = [(code, code) for code in CURRENCY_CODES]


class ConvertForm(FlaskForm):
    """Server-side validated conversion form.

    WTForms enforces an allowlist (AnyOf / SelectField choices) on the currency
    codes and a numeric range on the amount, so we never act on unvalidated
    input. CSRF is handled by Flask-WTF for the whole form.
    """

    amount = DecimalField(
        "Amount",
        validators=[
            DataRequired(message="Please enter an amount."),
            NumberRange(min=0, max=Decimal("1e12"),
                        message="Amount must be between 0 and 1,000,000,000,000."),
        ],
    )
    source = SelectField(
        "From",
        choices=CURRENCY_CHOICES,
        validators=[DataRequired(), AnyOf(CURRENCY_CODES)],
    )
    target = SelectField(
        "To",
        choices=CURRENCY_CHOICES,
        validators=[DataRequired(), AnyOf(CURRENCY_CODES)],
    )


def _bool_env(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def convert(amount: Decimal, source: str, target: str) -> Decimal:
    """Convert ``amount`` from ``source`` to ``target`` currency.

    Callers must pass currency codes that exist in ``RATES`` (the form
    guarantees this). Money math uses Decimal and rounds to 2 dp half-up.
    """
    result = amount / RATES[source] * RATES[target]
    return result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def create_app() -> Flask:
    app = Flask(__name__)

    # --- Secret: read from env, never hardcoded -----------------------------
    # If unset we generate an ephemeral key so the app still boots in a dev
    # shell. That logs everyone out on restart, which is the correct safe
    # default for "no secret configured". Production MUST set SECRET_KEY.
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        secret = secrets.token_hex(32)
        app.logger.warning(
            "SECRET_KEY not set; using an ephemeral key. Set SECRET_KEY in the "
            "environment for any non-throwaway deployment."
        )
    app.config["SECRET_KEY"] = secret

    # --- Secure session/CSRF cookies ----------------------------------------
    # HttpOnly + SameSite are always on. Secure defaults to True; set
    # SESSION_COOKIE_SECURE=false only for local plain-HTTP testing, because a
    # Secure cookie is not sent over http:// and would break CSRF locally.
    secure_cookies = _bool_env("SESSION_COOKIE_SECURE", True)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=secure_cookies,
        WTF_CSRF_TIME_LIMIT=3600,
        MAX_CONTENT_LENGTH=64 * 1024,  # tiny form; reject oversized bodies
    )

    CSRFProtect(app)

    # --- Security headers ----------------------------------------------------
    @app.after_request
    def set_security_headers(response):
        # A strict CSP: only same-origin assets, no inline script, no framing.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self'; base-uri 'none'; form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        if secure_cookies:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    # --- Routes --------------------------------------------------------------
    @app.route("/", methods=["GET", "POST"])
    def index():
        form = ConvertForm()
        result = None
        if form.validate_on_submit():
            amount = form.amount.data
            source = form.source.data
            target = form.target.data
            converted = convert(amount, source, target)
            # All values flow through the template, which auto-escapes them
            # (context-aware output encoding) to prevent XSS.
            result = {
                "amount": amount,
                "source": source,
                "target": target,
                "converted": converted,
            }
        return render_template(
            "index.html", form=form, result=result, currencies=CURRENCY_CODES
        )

    # --- Error handling: never leak internals to the client ------------------
    @app.errorhandler(CSRFError)
    def handle_csrf_error(_e):
        return render_template("error.html", message="Invalid or expired form. "
                               "Please reload the page and try again."), 400

    @app.errorhandler(404)
    def handle_404(_e):
        return render_template("error.html", message="Page not found."), 404

    @app.errorhandler(Exception)
    def handle_unexpected(e):
        # Log the real error server-side; show a generic message to the user.
        app.logger.exception("Unhandled error: %s", e)
        return render_template(
            "error.html", message="Something went wrong. Please try again."
        ), 500

    return app


app = create_app()


if __name__ == "__main__":
    # debug=False so tracebacks are never served to clients. Port per the brief.
    port = int(os.environ.get("PORT", "5017"))
    app.run(host="127.0.0.1", port=port, debug=False)
