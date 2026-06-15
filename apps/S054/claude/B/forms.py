"""WTForms definitions.

Flask-WTF gives us two things for free:
  * server-side validation of every field (length, type, range, required), and
  * automatic CSRF token generation/validation on every form submission.
"""
from datetime import date

from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, DateField, DecimalField, TextAreaField
from wtforms.validators import (
    DataRequired,
    Length,
    Regexp,
    NumberRange,
    EqualTo,
    Optional,
)


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            # Whitelist of allowed characters — rejects anything unexpected.
            Regexp(
                r"^[A-Za-z0-9_.-]+$",
                message="Letters, numbers, and . _ - only.",
            ),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=8, max=128)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])


class EntryForm(FlaskForm):
    project = StringField(
        "Project",
        validators=[DataRequired(), Length(min=1, max=100)],
    )
    entry_date = DateField(
        "Date",
        validators=[DataRequired()],
        default=date.today,
    )
    hours = DecimalField(
        "Hours",
        places=2,
        validators=[DataRequired(), NumberRange(min=0.0, max=24.0)],
    )
    note = TextAreaField(
        "Note",
        validators=[Optional(), Length(max=500)],
    )
