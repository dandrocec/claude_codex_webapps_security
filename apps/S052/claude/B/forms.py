"""WTForms definitions.

Flask-WTF wires every form to CSRF protection automatically (a hidden token is
required on submit), and the validators below enforce server-side input
validation and length limits (OWASP A03/A04). Rendering form data through Jinja
templates applies context-aware HTML escaping, mitigating XSS (OWASP A03).
"""
from flask_wtf import FlaskForm
from wtforms import StringField, TextAreaField, SelectField, PasswordField
from wtforms.validators import DataRequired, Length, Regexp, EqualTo

from db import PRIORITIES


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=32),
            # Allow-list of characters rather than blocking "bad" ones.
            Regexp(
                r"^[A-Za-z0-9_.-]+$",
                message="Use letters, numbers, and . _ - only.",
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


class TicketForm(FlaskForm):
    subject = StringField(
        "Subject", validators=[DataRequired(), Length(min=3, max=120)]
    )
    description = TextAreaField(
        "Description", validators=[DataRequired(), Length(min=5, max=5000)]
    )
    priority = SelectField(
        "Priority",
        choices=[(p, p.capitalize()) for p in PRIORITIES],
        validators=[DataRequired()],
    )
