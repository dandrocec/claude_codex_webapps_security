"""WTForms definitions.

Flask-WTF gives us two things for free:

* CSRF protection on every form (a hidden token validated on POST).
* Server-side input validation / length limits, which is the first half
  of "validate and sanitise all user input". Output encoding (the second
  half) is handled by Jinja2 autoescaping in the templates.
"""

from flask_wtf import FlaskForm
from wtforms import (
    StringField,
    PasswordField,
    TextAreaField,
    BooleanField,
    SelectField,
)
from wtforms.validators import DataRequired, Length, Regexp, EqualTo


# Usernames: conservative allow-list to avoid surprises in URLs / display.
USERNAME_RE = r"^[A-Za-z0-9_.-]+$"
# Slugs are part of the URL path; keep them strict.
SLUG_RE = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            Regexp(USERNAME_RE, message="Letters, digits, _ . - only."),
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
    role = SelectField(
        "Role",
        choices=[("viewer", "Viewer"), ("editor", "Editor")],
        validators=[DataRequired()],
    )


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])


class PageForm(FlaskForm):
    """Used both for creating and editing pages."""

    title = StringField("Title", validators=[DataRequired(), Length(min=1, max=200)])
    slug = StringField(
        "Slug (URL)",
        validators=[
            DataRequired(),
            Length(min=1, max=120),
            Regexp(SLUG_RE, message="Lowercase words separated by single hyphens."),
        ],
    )
    content = TextAreaField("Content", validators=[Length(max=100_000)])
    comment = StringField("Edit summary", validators=[Length(max=300)])
    editor_only = BooleanField("Editor-only page")


class EditForm(FlaskForm):
    """Editing an existing page (slug is fixed once created)."""

    title = StringField("Title", validators=[DataRequired(), Length(min=1, max=200)])
    content = TextAreaField("Content", validators=[Length(max=100_000)])
    comment = StringField("Edit summary", validators=[Length(max=300)])
    editor_only = BooleanField("Editor-only page")


class ConfirmForm(FlaskForm):
    """Bare form: just carries the CSRF token for POST-only actions."""
