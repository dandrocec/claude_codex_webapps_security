"""WTForms definitions.

Using Flask-WTF gives us two things for free:

* Server-side input validation (length, format, required, range).
* A CSRF token on every form, validated automatically by CSRFProtect
  (OWASP A01 / CSRF).
"""

from datetime import datetime

from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, SelectField, DateTimeLocalField
from wtforms.validators import (
    DataRequired,
    Email,
    Length,
    EqualTo,
    AnyOf,
    ValidationError,
)


class RegisterForm(FlaskForm):
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=254)],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=10, max=128)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    role = SelectField(
        "I am a",
        choices=[("client", "Client"), ("provider", "Provider")],
        validators=[DataRequired(), AnyOf(["client", "provider"])],
    )


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])


class SlotForm(FlaskForm):
    start_time = DateTimeLocalField(
        "Start", format="%Y-%m-%dT%H:%M", validators=[DataRequired()]
    )
    end_time = DateTimeLocalField(
        "End", format="%Y-%m-%dT%H:%M", validators=[DataRequired()]
    )

    def validate_start_time(self, field):
        if field.data and field.data < datetime.now():
            raise ValidationError("Start time cannot be in the past.")

    def validate_end_time(self, field):
        if field.data and self.start_time.data and field.data <= self.start_time.data:
            raise ValidationError("End time must be after the start time.")


class EmptyForm(FlaskForm):
    """Bare form used to carry a CSRF token for POST-only actions
    (book, cancel, delete)."""
