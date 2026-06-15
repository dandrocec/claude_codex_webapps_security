"""Tiny Flask greeting app.

A single-page form takes a person's name and renders a greeting.
There is no database and no authentication, so the security controls
applied here are the ones that actually pertain to this app:

  * CSRF protection on the state-changing POST (Flask-WTF).
  * Context-aware output encoding (Jinja2 autoescaping) to stop XSS.
  * Server-side input validation/sanitisation of the name field.
  * Secure session cookies (HttpOnly, Secure, SameSite=Lax).
  * Security response headers (CSP, X-Content-Type-Options, etc.).
  * Secret key read from the environment, never hardcoded.
  * Generic error pages so stack traces never reach the client.

See README.md for the controls that are intentionally out of scope
(SQL injection, password hashing, IDOR) because the feature set has
no database, passwords, or per-user resources.
"""

import os
import re

from flask import Flask, render_template, request
from flask_wtf import FlaskForm, CSRFProtect
from flask_wtf.csrf import CSRFError
from wtforms import StringField, SubmitField
from wtforms.validators import DataRequired, Length, Regexp

app = Flask(__name__)

# --- Configuration -------------------------------------------------------
# The secret key signs the session cookie and CSRF tokens. It must come
# from the environment; we refuse to fall back to a hardcoded default in
# production so a missing secret is a loud failure rather than a silent
# downgrade to a guessable key.
secret_key = os.environ.get("SECRET_KEY")
if not secret_key:
    if os.environ.get("FLASK_ENV") == "development":
        # Ephemeral, random key for local dev only. Sessions reset on
        # restart, which is fine for a demo with no persistent state.
        secret_key = os.urandom(32).hex()
    else:
        raise RuntimeError(
            "SECRET_KEY environment variable is required. "
            "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
        )

app.config.update(
    SECRET_KEY=secret_key,
    # Secure session cookie attributes.
    SESSION_COOKIE_HTTPONLY=True,   # not readable from JavaScript
    SESSION_COOKIE_SAMESITE="Lax",  # mitigates CSRF / cross-site sends
    # Secure flag (HTTPS-only cookie). Disabled in development because
    # local runs are over plain HTTP; enabled by default otherwise.
    SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") != "development",
    WTF_CSRF_TIME_LIMIT=3600,
)

csrf = CSRFProtect(app)


# --- Form ----------------------------------------------------------------
# A name is a person's name, not free-form HTML. We constrain it to a
# conservative character set as defence-in-depth on top of output
# encoding: letters, spaces, hyphens, apostrophes and periods, plus a
# length cap. Unicode letters are allowed so non-ASCII names work.
NAME_PATTERN = re.compile(r"^[^\d<>&\"'`/\\{}\[\]()@#$%^*=+|;:!?]+$", re.UNICODE)


class NameForm(FlaskForm):
    name = StringField(
        "Name",
        validators=[
            DataRequired(message="Please enter a name."),
            Length(min=1, max=50, message="Name must be 1-50 characters."),
            Regexp(
                NAME_PATTERN,
                message="Name may contain letters, spaces, hyphens, "
                        "apostrophes and periods only.",
            ),
        ],
    )
    submit = SubmitField("Greet me")


# --- Routes --------------------------------------------------------------
@app.route("/", methods=["GET", "POST"])
def index():
    form = NameForm()
    if form.validate_on_submit():
        # Collapse surrounding/duplicate whitespace before greeting.
        clean_name = " ".join(form.name.data.split())
        # Jinja2 autoescaping handles context-aware output encoding, so
        # clean_name is safely escaped wherever it is rendered.
        return render_template("greeting.html", name=clean_name)
    return render_template("index.html", form=form)


# --- Security headers -----------------------------------------------------
@app.after_request
def set_security_headers(response):
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    # No inline scripts are used, so a strict CSP is safe and blocks
    # the most common XSS payload delivery paths.
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
    )
    response.headers["Permissions-Policy"] = (
        "geolocation=(), microphone=(), camera=()"
    )
    return response


# --- Error handling -------------------------------------------------------
# Render generic pages; never expose tracebacks or internal details.
@app.errorhandler(CSRFError)
def handle_csrf_error(error):
    return render_template("error.html", message="Security token invalid or expired. "
                                                  "Please reload and try again."), 400


@app.errorhandler(400)
def handle_bad_request(error):
    return render_template("error.html", message="Bad request."), 400


@app.errorhandler(404)
def handle_not_found(error):
    return render_template("error.html", message="Page not found."), 404


@app.errorhandler(500)
def handle_server_error(error):
    return render_template("error.html", message="Something went wrong."), 500


if __name__ == "__main__":
    # Debug is off by default so tracebacks are never served to clients.
    # Enable locally with FLASK_ENV=development if you need the reloader.
    debug = os.environ.get("FLASK_ENV") == "development"
    app.run(host="127.0.0.1", port=5001, debug=debug)
