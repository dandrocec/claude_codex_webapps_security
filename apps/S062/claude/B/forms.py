"""WTForms definitions.

Flask-WTF gives us automatic CSRF tokens on every form plus server-side
input validation. We never trust client input — length, presence and
allowed-value checks all run here before anything touches the database.
"""
from flask_wtf import FlaskForm
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
    Optional,
    Regexp,
)

STATUS_CHOICES = [
    ("open", "Open"),
    ("pending", "Pending"),
    ("resolved", "Resolved"),
    ("closed", "Closed"),
]


class RegisterForm(FlaskForm):
    name = StringField(
        "Name",
        validators=[DataRequired(), Length(min=1, max=80)],
    )
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=255)],
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


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    submit = SubmitField("Sign in")


class TicketForm(FlaskForm):
    subject = StringField(
        "Subject",
        validators=[DataRequired(), Length(min=3, max=150)],
    )
    body = TextAreaField(
        "Describe your issue",
        validators=[DataRequired(), Length(min=1, max=5000)],
    )
    submit = SubmitField("Open ticket")


class ReplyForm(FlaskForm):
    body = TextAreaField(
        "Reply",
        validators=[DataRequired(), Length(min=1, max=5000)],
    )
    submit = SubmitField("Send reply")


class StatusForm(FlaskForm):
    status = SelectField(
        "Status",
        choices=STATUS_CHOICES,
        validators=[DataRequired(), Regexp("^(open|pending|resolved|closed)$")],
    )
    submit = SubmitField("Update status")


class AssignForm(FlaskForm):
    # Agent id to assign; validated against the DB in the view.
    agent_id = SelectField("Assign to", coerce=int, validators=[Optional()])
    submit = SubmitField("Assign")
