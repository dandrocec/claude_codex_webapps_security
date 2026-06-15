"""WTForms definitions.

WTForms gives us server-side input validation plus, via Flask-WTF, automatic
CSRF tokens on every form. Validation here enforces length bounds and the
allowed enum/range values; Jinja2's autoescaping handles output encoding.
"""
from flask_wtf import FlaskForm
from wtforms import (
    HiddenField,
    PasswordField,
    SelectField,
    StringField,
    SubmitField,
)
from wtforms.validators import (
    DataRequired,
    EqualTo,
    Length,
    Optional,
    Regexp,
)

STATUS_CHOICES = [
    ("to-read", "To read"),
    ("reading", "Reading"),
    ("finished", "Finished"),
]

RATING_CHOICES = [
    ("", "— No rating —"),
    ("1", "1"),
    ("2", "2"),
    ("3", "3"),
    ("4", "4"),
    ("5", "5"),
]


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            Regexp(
                r"^[A-Za-z0-9_.-]+$",
                message="Letters, digits, and . _ - only.",
            ),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=8, max=128)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[
            DataRequired(),
            EqualTo("password", message="Passwords must match."),
        ],
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Log in")


class BookForm(FlaskForm):
    title = StringField("Title", validators=[DataRequired(), Length(max=200)])
    author = StringField("Author", validators=[DataRequired(), Length(max=200)])
    status = SelectField("Status", choices=STATUS_CHOICES, validators=[DataRequired()])
    rating = SelectField(
        "Rating",
        choices=RATING_CHOICES,
        validators=[Optional()],
    )
    submit = SubmitField("Save")


class DeleteForm(FlaskForm):
    """Bare form used purely to carry a CSRF token for delete actions."""

    submit = SubmitField("Delete")
