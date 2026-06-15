"""A small Flask app that shows a random inspirational quote.

Security posture (OWASP Top 10 oriented):
  * Output is rendered through Jinja2 autoescaping (context-aware encoding) -> XSS safe.
  * CSRF protection is enabled globally via Flask-WTF for any state-changing request.
  * Secure session cookies (HttpOnly, SameSite, and Secure when served over HTTPS).
  * Security headers are set on every response.
  * Secrets are read from the environment, never hardcoded.
  * Errors are handled without leaking stack traces to clients.

Note: this app has no database and no authentication, so SQL injection,
password hashing and IDOR/access-control controls have no attack surface here.
The patterns that *do* apply are implemented below.
"""
from __future__ import annotations

import os
import secrets

from flask import Flask, jsonify, render_template
from flask_wtf import CSRFProtect

# A small, curated, built-in list of quotes. Treated as trusted, static content.
QUOTES: list[dict[str, str]] = [
    {"text": "The only way to do great work is to love what you do.", "author": "Steve Jobs"},
    {"text": "Success is not final, failure is not fatal: it is the courage to continue that counts.", "author": "Winston Churchill"},
    {"text": "The future belongs to those who believe in the beauty of their dreams.", "author": "Eleanor Roosevelt"},
    {"text": "It does not matter how slowly you go as long as you do not stop.", "author": "Confucius"},
    {"text": "Believe you can and you're halfway there.", "author": "Theodore Roosevelt"},
    {"text": "Everything you've ever wanted is on the other side of fear.", "author": "George Addair"},
    {"text": "Hardships often prepare ordinary people for an extraordinary destiny.", "author": "C.S. Lewis"},
    {"text": "Act as if what you do makes a difference. It does.", "author": "William James"},
    {"text": "Quality is not an act, it is a habit.", "author": "Aristotle"},
    {"text": "Start where you are. Use what you have. Do what you can.", "author": "Arthur Ashe"},
]


def random_quote() -> dict[str, str]:
    """Return a cryptographically-strong random choice (avoids predictable PRNG)."""
    return secrets.choice(QUOTES)


def create_app() -> Flask:
    app = Flask(__name__)

    # Secret key MUST come from the environment. Generate an ephemeral one for
    # local dev if unset, but warn — a fixed key should be provided in prod.
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        secret_key = secrets.token_hex(32)
        app.logger.warning(
            "SECRET_KEY not set; using an ephemeral key. Set SECRET_KEY for production."
        )
    app.config["SECRET_KEY"] = secret_key

    # Secure session cookie configuration.
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        # Only send the cookie over HTTPS when running behind TLS. Controlled by
        # env so local http://localhost development still works.
        SESSION_COOKIE_SECURE=os.environ.get("FORCE_HTTPS", "false").lower() == "true",
    )

    # Global CSRF protection. Any future POST/PUT/DELETE route is protected.
    csrf = CSRFProtect(app)

    @app.after_request
    def set_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; style-src 'self'; script-src 'self'; "
            "base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        if app.config["SESSION_COOKIE_SECURE"]:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        return response

    @app.route("/")
    def index():
        # Autoescaped by Jinja2 -> context-aware output encoding, XSS safe.
        return render_template("index.html", quote=random_quote())

    @app.route("/api/quote")
    def api_quote():
        # Read-only endpoint used by the "another quote" button. GET is correct
        # because fetching a quote is not a state-changing operation.
        return jsonify(random_quote())

    @app.errorhandler(404)
    def not_found(_error):
        return render_template("error.html", code=404, message="Page not found"), 404

    @app.errorhandler(500)
    def server_error(_error):
        # Never leak stack traces or internal details to the client.
        return render_template("error.html", code=500, message="Something went wrong"), 500

    return app


app = create_app()


if __name__ == "__main__":
    # debug must stay False so the Werkzeug debugger/stack traces are never
    # exposed. Bind to localhost on the required port.
    app.run(host="127.0.0.1", port=5014, debug=False)
