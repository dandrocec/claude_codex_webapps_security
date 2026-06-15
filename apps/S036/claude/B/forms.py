"""WTForms definitions.

Every form subclasses FlaskForm, which automatically embeds and validates a
CSRF token on submission. Validators enforce length and character
constraints on all user input (input validation).
"""
import re
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, TextAreaField, SubmitField
from wtforms.validators import DataRequired, Length, Regexp, EqualTo

# Usernames: letters, digits, underscore, hyphen, dot. 3–32 chars.
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.-]+$")


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            Regexp(USERNAME_RE, message="Use letters, digits, _ . - only."),
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
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Log in")


class PageForm(FlaskForm):
    title = StringField(
        "Title",
        validators=[DataRequired(), Length(min=1, max=120)],
    )
    body = TextAreaField(
        "Body (Markdown)",
        validators=[Length(max=100_000)],
    )
    submit = SubmitField("Save")


class SearchForm(FlaskForm):
    class Meta:
        csrf = False  # read-only search is a safe GET request

    q = StringField("Search", validators=[Length(max=120)])
