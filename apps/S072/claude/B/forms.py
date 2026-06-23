"""WTForms definitions.

Flask-WTF gives us:
  * server-side input validation (length, format, required), and
  * automatic CSRF protection on every form-bearing POST (OWASP A01/A03).
"""
from flask_wtf import FlaskForm
from wtforms import HiddenField, PasswordField, SelectField, StringField
from wtforms.validators import (DataRequired, Email, EqualTo, Length, Regexp,
                                ValidationError)

from security import MAX_PASSWORD_BYTES

NAME_PATTERN = r"^[\w .'\-]+$"  # letters/digits/underscore + space . ' -


def _no_long_password(_form, field):
    if len(field.data.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValidationError(
            f"Password must be at most {MAX_PASSWORD_BYTES} bytes long."
        )


class RegisterForm(FlaskForm):
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=255)],
    )
    display_name = StringField(
        "Display name",
        validators=[
            DataRequired(),
            Length(min=2, max=60),
            Regexp(NAME_PATTERN, message="Use letters, numbers, spaces, . ' or -."),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=12, max=200), _no_long_password],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=200)])


class ProfileForm(FlaskForm):
    display_name = StringField(
        "Display name",
        validators=[
            DataRequired(),
            Length(min=2, max=60),
            Regexp(NAME_PATTERN, message="Use letters, numbers, spaces, . ' or -."),
        ],
    )


class ChangeTierForm(FlaskForm):
    """Admin action: change a target user's tier. CSRF-protected."""
    user_id = HiddenField(validators=[DataRequired()])
    tier = SelectField(
        "Tier",
        choices=[("free", "Free"), ("premium", "Premium")],
        validators=[DataRequired()],
    )
