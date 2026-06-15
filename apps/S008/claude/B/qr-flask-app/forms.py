"""WTForms form definitions.

Flask-WTF gives us:
  * Automatic CSRF tokens on every form (validated on POST).
  * Server-side input validation that runs before any business logic.
"""
from flask_wtf import FlaskForm
from wtforms import PasswordField, StringField, SubmitField
from wtforms.validators import (
    DataRequired,
    Email,
    EqualTo,
    Length,
    ValidationError,
)


def _no_control_chars(form, field):
    """Reject NUL and other C0 control characters (except tab/newline)."""
    value = field.data or ""
    for ch in value:
        if ord(ch) < 0x20 and ch not in "\t\n\r":
            raise ValidationError("Input contains invalid control characters.")


class QRForm(FlaskForm):
    content = StringField(
        "Text or URL",
        validators=[
            DataRequired(message="Please enter some text or a URL."),
            Length(max=1800, message="Input is too long for a QR code (max 1800 characters)."),
            _no_control_chars,
        ],
    )
    submit = SubmitField("Generate QR code")

    def filter_content(self, value):  # WTForms input filter
        return value.strip() if value else value


class RegisterForm(FlaskForm):
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=255)],
    )
    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=12, max=128, message="Password must be at least 12 characters."),
        ],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Log in")
