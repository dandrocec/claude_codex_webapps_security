"""WTForms definitions.

WTForms gives us:
  * server-side input validation (length, format, required fields);
  * automatic CSRF protection (via Flask-WTF) on every form submission.

Output is rendered through Jinja2, which auto-escapes by default, providing
context-aware HTML encoding to prevent XSS. We never mark user data safe.
"""
from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileRequired
from wtforms import (
    PasswordField,
    SelectField,
    StringField,
    SubmitField,
    TextAreaField,
)
from wtforms.validators import (
    DataRequired,
    Email,
    EqualTo,
    Length,
    Regexp,
)


class RegisterForm(FlaskForm):
    full_name = StringField(
        "Full name",
        validators=[DataRequired(), Length(min=1, max=120)],
    )
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=255)],
    )
    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=10, max=200, message="Password must be at least 10 characters."),
        ],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    role = SelectField(
        "I am an",
        choices=[("applicant", "Applicant"), ("employer", "Employer")],
        validators=[DataRequired(), Regexp("^(applicant|employer)$")],
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=200)])
    submit = SubmitField("Log in")


class JobForm(FlaskForm):
    title = StringField("Title", validators=[DataRequired(), Length(min=2, max=140)])
    location = StringField("Location", validators=[DataRequired(), Length(min=2, max=140)])
    description = TextAreaField(
        "Description",
        validators=[DataRequired(), Length(min=10, max=10000)],
    )
    submit = SubmitField("Post job")


class ApplicationForm(FlaskForm):
    cover_letter = TextAreaField(
        "Cover letter (optional)",
        validators=[Length(max=10000)],
    )
    resume = FileField(
        "Resume (PDF, DOC or DOCX)",
        validators=[FileRequired(message="A resume file is required.")],
    )
    submit = SubmitField("Submit application")


class StatusForm(FlaskForm):
    """Used by employers to update an application's status."""
    status = SelectField(
        "Status",
        choices=[
            ("submitted", "Submitted"),
            ("reviewed", "Reviewed"),
            ("accepted", "Accepted"),
            ("rejected", "Rejected"),
        ],
        validators=[DataRequired(), Regexp("^(submitted|reviewed|accepted|rejected)$")],
    )
    submit = SubmitField("Update")
