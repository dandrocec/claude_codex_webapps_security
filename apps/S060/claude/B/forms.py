"""WTForms form definitions.

WTForms gives us:
  * server-side input validation (length, format, required fields);
  * CSRF tokens on every form (via Flask-WTF), so all state-changing
    POST requests are CSRF-protected.
"""
from flask_wtf import FlaskForm
from wtforms import (
    BooleanField,
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
    ValidationError,
)

USERNAME_RE = r"^[A-Za-z0-9_.-]+$"


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            Regexp(
                USERNAME_RE,
                message="Username may only contain letters, numbers, '_', '.' and '-'.",
            ),
        ],
    )
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    role = SelectField(
        "Role",
        choices=[("reader", "Reader"), ("author", "Author"), ("editor", "Editor")],
        validators=[DataRequired()],
    )
    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=10, max=128, message="Use at least 10 characters."),
        ],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    submit = SubmitField("Create account")

    def validate_role(self, field):
        # Defence in depth: never trust the client-submitted role value.
        if field.data not in {"reader", "author", "editor"}:
            raise ValidationError("Invalid role.")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[DataRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    remember = BooleanField("Remember me")
    submit = SubmitField("Log in")


class PostForm(FlaskForm):
    title = StringField("Title", validators=[DataRequired(), Length(min=3, max=200)])
    body = TextAreaField("Body", validators=[DataRequired(), Length(min=1, max=20000)])
    submit = SubmitField("Save draft")
    submit_for_review = SubmitField("Save & submit for review")


class ReviewForm(FlaskForm):
    """Used by editors to approve/reject a submitted post."""
    review_note = TextAreaField("Note to author (optional)", validators=[Length(max=2000)])
    approve = SubmitField("Approve")
    reject = SubmitField("Reject")
