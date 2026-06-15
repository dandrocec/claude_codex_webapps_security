"""Temperature converter web app.

A minimal Flask application that converts between Celsius and Fahrenheit.
Security controls applied (OWASP Top 10, where applicable to this app):
  - CSRF protection on all state-changing requests (Flask-WTF).
  - Strict server-side input validation.
  - Context-aware output encoding (Jinja2 autoescaping, enabled by default).
  - Security headers (CSP, X-Content-Type-Options, etc.).
  - Secure session cookies (HttpOnly, Secure, SameSite).
  - No internal errors / stack traces leaked to clients.
  - Secret key read from the environment, never hardcoded.

Note: this app has no database and no authentication, so the SQL-injection,
password-hashing, and access-control (IDOR) requirements have no surface to
apply to. See README.md for details.
"""

import os

from flask import Flask, render_template, request
from flask_wtf import FlaskForm, CSRFProtect
from wtforms import DecimalField, RadioField, SubmitField
from wtforms.validators import DataRequired, NumberRange, InputRequired

# Physically meaningful lower bounds (absolute zero). Upper bound is a sane
# guard against absurd input rather than a physical limit.
ABS_ZERO_C = -273.15
ABS_ZERO_F = -459.67
MAX_MAGNITUDE = 1_000_000_000


def create_app() -> Flask:
    app = Flask(__name__)

    # --- Secrets: read from environment, never hardcode. -------------------
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        if app.debug or app.testing:
            # Ephemeral key for local development only.
            secret_key = os.urandom(32).hex()
        else:
            raise RuntimeError(
                "SECRET_KEY environment variable must be set in production."
            )
    app.config["SECRET_KEY"] = secret_key

    # --- Secure session cookies. ------------------------------------------
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Secure cookies require HTTPS. Allow opt-out for local plain-HTTP dev.
        SESSION_COOKIE_SECURE=os.environ.get("COOKIE_SECURE", "1") == "1",
        WTF_CSRF_TIME_LIMIT=3600,
    )

    CSRFProtect(app)

    @app.after_request
    def set_security_headers(response):
        # Lock down what the page is allowed to load. The app uses no external
        # scripts/styles, so a tight self-only policy is appropriate.
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self'; script-src 'self'; "
            "img-src 'self'; base-uri 'none'; form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = (
            "geolocation=(), microphone=(), camera=()"
        )
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.errorhandler(Exception)
    def handle_unexpected_error(exc):
        # Never leak stack traces or internal details to the client.
        app.logger.exception("Unhandled error: %s", exc)
        return render_template("error.html", message="Something went wrong."), 500

    @app.route("/", methods=["GET", "POST"])
    def index():
        form = ConversionForm()
        result = None
        if form.validate_on_submit():
            value = float(form.value.data)
            direction = form.direction.data
            if direction == "c2f":
                converted = value * 9 / 5 + 32
                result = {
                    "input": f"{value:g} °C",
                    "output": f"{converted:g} °F",
                }
            else:  # f2c
                converted = (value - 32) * 5 / 9
                result = {
                    "input": f"{value:g} °F",
                    "output": f"{converted:g} °C",
                }
        return render_template("index.html", form=form, result=result)

    return app


class ConversionForm(FlaskForm):
    value = DecimalField(
        "Temperature value",
        validators=[
            InputRequired(message="Please enter a temperature."),
            NumberRange(
                min=-MAX_MAGNITUDE,
                max=MAX_MAGNITUDE,
                message="Value is out of the supported range.",
            ),
        ],
    )
    direction = RadioField(
        "Direction",
        choices=[
            ("c2f", "Celsius → Fahrenheit"),
            ("f2c", "Fahrenheit → Celsius"),
        ],
        default="c2f",
        validators=[DataRequired(message="Please choose a conversion direction.")],
    )
    submit = SubmitField("Convert")

    def validate(self, extra_validators=None):
        # Run the standard field validators first.
        if not super().validate(extra_validators=extra_validators):
            return False
        # Enforce physical lower bounds depending on the chosen scale.
        value = float(self.value.data)
        if self.direction.data == "c2f" and value < ABS_ZERO_C:
            self.value.errors.append(
                f"Celsius cannot be below absolute zero ({ABS_ZERO_C} °C)."
            )
            return False
        if self.direction.data == "f2c" and value < ABS_ZERO_F:
            self.value.errors.append(
                f"Fahrenheit cannot be below absolute zero ({ABS_ZERO_F} °F)."
            )
            return False
        return True


app = create_app()


if __name__ == "__main__":
    # Local development entry point. Bind to localhost on port 5004.
    port = int(os.environ.get("PORT", "5004"))
    app.run(host="127.0.0.1", port=port, debug=False)
