"""WTForms definitions.

Flask-WTF gives us automatic CSRF protection on every form-backed POST, plus
server-side validation/normalisation of all user input. Output is encoded by
Jinja's autoescaping at render time (context-aware for HTML).
"""
from flask_wtf import FlaskForm
from flask_wtf.file import FileField, FileAllowed
from wtforms import StringField, TextAreaField, PasswordField, SubmitField
from wtforms.validators import (
    DataRequired,
    Length,
    Email,
    EqualTo,
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
                message="Only letters, numbers, and . _ - are allowed.",
            ),
        ],
    )
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=255)],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=10, max=128)],
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


class RecipeForm(FlaskForm):
    title = StringField(
        "Title",
        validators=[DataRequired(), Length(min=1, max=140)],
    )
    ingredients = TextAreaField(
        "Ingredients (one per line)",
        validators=[DataRequired(), Length(min=1, max=5000)],
    )
    steps = TextAreaField(
        "Steps",
        validators=[DataRequired(), Length(min=1, max=20000)],
    )
    photo = FileField(
        "Photo (optional)",
        validators=[
            FileAllowed(
                ["png", "jpg", "jpeg", "gif", "webp"],
                "Images only (png, jpg, jpeg, gif, webp).",
            )
        ],
    )
    submit = SubmitField("Save recipe")
