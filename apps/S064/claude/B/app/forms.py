"""WTForms definitions.

WTForms validates and normalises every field server-side. Combined with
Flask-WTF this also injects and verifies a CSRF token on each form, so all
state-changing POST requests are CSRF-protected.
"""
from flask_wtf import FlaskForm
from wtforms import (
    StringField,
    PasswordField,
    TextAreaField,
    SelectField,
    SubmitField,
)
from wtforms.validators import (
    DataRequired,
    Email,
    Length,
    EqualTo,
    Optional,
    Regexp,
)

from app.models import TASK_STATUSES


class RegistrationForm(FlaskForm):
    username = StringField(
        "Display name",
        validators=[
            DataRequired(),
            Length(min=2, max=80),
            Regexp(r"^[\w .'-]+$", message="Letters, numbers and . ' - only."),
        ],
    )
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField(
        "Password", validators=[DataRequired(), Length(min=10, max=128)]
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


class ProjectForm(FlaskForm):
    name = StringField("Project name", validators=[DataRequired(), Length(min=1, max=120)])
    description = TextAreaField(
        "Description", validators=[Optional(), Length(max=2000)]
    )
    submit = SubmitField("Save project")


class InviteForm(FlaskForm):
    email = StringField(
        "Member email", validators=[DataRequired(), Email(), Length(max=255)]
    )
    submit = SubmitField("Invite member")


class TaskForm(FlaskForm):
    title = StringField("Title", validators=[DataRequired(), Length(min=1, max=200)])
    description = TextAreaField(
        "Description", validators=[Optional(), Length(max=4000)]
    )
    status = SelectField(
        "Status",
        choices=[(s, s.capitalize()) for s in TASK_STATUSES],
        validators=[DataRequired()],
    )
    # Assignee choices are populated per-request from the project's members.
    assignee_id = SelectField("Assignee", coerce=str, validators=[Optional()])
    submit = SubmitField("Save task")


class StatusForm(FlaskForm):
    """Minimal CSRF-protected form for moving a task between columns."""

    status = SelectField(
        "Status",
        choices=[(s, s.capitalize()) for s in TASK_STATUSES],
        validators=[DataRequired()],
    )
    submit = SubmitField("Move")


class DeleteForm(FlaskForm):
    """Empty form used only to carry a CSRF token for delete actions."""

    submit = SubmitField("Delete")
