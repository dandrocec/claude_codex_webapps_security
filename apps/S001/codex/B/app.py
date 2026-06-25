import os
import re

from flask import Flask, abort, redirect, render_template, session, url_for
from flask_wtf import CSRFProtect, FlaskForm
from wtforms import StringField, SubmitField
from wtforms.validators import DataRequired, Length, Regexp


def create_app() -> Flask:
    app = Flask(__name__)
    secret_key = os.environ.get("SECRET_KEY")
    if not secret_key:
        raise RuntimeError("SECRET_KEY environment variable is required")

    app.config.update(
        SECRET_KEY=secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SECURE=os.environ.get("FLASK_ENV") != "development",
        SESSION_COOKIE_SAMESITE="Lax",
        WTF_CSRF_TIME_LIMIT=3600,
        MAX_CONTENT_LENGTH=1024,
    )

    CSRFProtect(app)

    @app.after_request
    def set_security_headers(response):
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "base-uri 'self'; "
            "form-action 'self'; "
            "frame-ancestors 'none'"
        )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"
        return response

    @app.errorhandler(400)
    @app.errorhandler(403)
    @app.errorhandler(404)
    @app.errorhandler(413)
    @app.errorhandler(500)
    def handle_error(error):
        status_code = getattr(error, "code", 500)
        return render_template("error.html", status_code=status_code), status_code

    @app.route("/", methods=["GET", "POST"])
    def index():
        form = NameForm()
        if form.validate_on_submit():
            name = normalise_name(form.name.data)
            session["submitted_name"] = name
            return redirect(url_for("greet"))
        return render_template("index.html", form=form)

    @app.route("/greet", methods=["GET"])
    def greet():
        name = session.get("submitted_name")
        if not name:
            abort(404)
        return render_template("greet.html", name=name)

    return app


def normalise_name(value: str | None) -> str:
    if value is None:
        return ""
    collapsed = re.sub(r"\s+", " ", value).strip()
    return collapsed


class NameForm(FlaskForm):
    name = StringField(
        "Name",
        filters=[normalise_name],
        validators=[
            DataRequired(message="Enter a name."),
            Length(min=1, max=80, message="Name must be 80 characters or fewer."),
            Regexp(
                r"^[A-Za-z][A-Za-z .'-]*$",
                message="Use letters, spaces, apostrophes, hyphens, or periods.",
            ),
        ],
    )
    submit = SubmitField("Submit")


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5001)
