"""WTForms definitions.

WTForms gives us server-side input validation and, via Flask-WTF, automatic
CSRF protection (a hidden token is rendered by ``form.hidden_tag()`` and
verified on submit).
"""
from datetime import date

from flask_wtf import FlaskForm
from wtforms import DateField, PasswordField, StringField, SubmitField, TextAreaField
from wtforms.validators import (
    EqualTo,
    InputRequired,
    Length,
    Regexp,
    ValidationError,
)


class RegistrationForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            InputRequired(),
            Length(min=3, max=32),
            Regexp(
                r"^[A-Za-z0-9_.-]+$",
                message="Only letters, digits and . _ - are allowed.",
            ),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[InputRequired(), Length(min=8, max=128)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[InputRequired(), EqualTo("password", message="Passwords must match.")],
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[InputRequired(), Length(max=32)])
    password = PasswordField("Password", validators=[InputRequired(), Length(max=128)])
    submit = SubmitField("Log in")


class EventForm(FlaskForm):
    title = StringField("Title", validators=[InputRequired(), Length(min=1, max=120)])
    event_date = DateField("Date", validators=[InputRequired()])
    location = StringField("Location", validators=[InputRequired(), Length(min=1, max=120)])
    description = TextAreaField(
        "Description", validators=[InputRequired(), Length(min=1, max=2000)]
    )
    submit = SubmitField("Save event")

    def validate_event_date(self, field):
        if field.data < date.today():
            raise ValidationError("The event date cannot be in the past.")
