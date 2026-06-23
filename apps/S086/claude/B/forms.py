"""WTForms definitions.

WTForms provides server-side validation/sanitisation of every field, and
Flask-WTF wires in CSRF protection automatically for every form-backed POST.
"""
import re

from flask_wtf import FlaskForm
from wtforms import (
    BooleanField,
    PasswordField,
    StringField,
    SubmitField,
)
from wtforms.validators import (
    DataRequired,
    Email,
    EqualTo,
    Length,
    Optional,
    Regexp,
    ValidationError,
)

USERNAME_RE = r"^[A-Za-z0-9_.-]+$"

# Strong-ish password policy: length is the dominant factor.
PASSWORD_MIN = 12
PASSWORD_MAX = 72  # bcrypt's effective byte limit


def _strong_password(form, field):
    pw = field.data or ""
    checks = [
        re.search(r"[a-z]", pw),
        re.search(r"[A-Z]", pw),
        re.search(r"\d", pw),
        re.search(r"[^A-Za-z0-9]", pw),
    ]
    if sum(bool(c) for c in checks) < 3:
        raise ValidationError(
            "Password must include at least three of: lowercase, uppercase, "
            "digit, symbol."
        )


class LoginForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[DataRequired(), Length(max=64)],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(max=PASSWORD_MAX)],
    )
    submit = SubmitField("Sign in")


class UserCreateForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=64),
            Regexp(USERNAME_RE, message="Use only letters, numbers, . _ -"),
        ],
    )
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=254)],
    )
    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=PASSWORD_MIN, max=PASSWORD_MAX),
            _strong_password,
        ],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match")],
    )
    is_admin = BooleanField("Administrator")
    is_active = BooleanField("Active", default=True)
    submit = SubmitField("Create user")


class UserEditForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            DataRequired(),
            Length(min=3, max=64),
            Regexp(USERNAME_RE, message="Use only letters, numbers, . _ -"),
        ],
    )
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=254)],
    )
    password = PasswordField(
        "New password (leave blank to keep current)",
        validators=[
            Optional(),
            Length(min=PASSWORD_MIN, max=PASSWORD_MAX),
            _strong_password,
        ],
    )
    confirm = PasswordField(
        "Confirm new password",
        validators=[EqualTo("password", message="Passwords must match")],
    )
    is_admin = BooleanField("Administrator")
    is_active = BooleanField("Active")
    submit = SubmitField("Save changes")


class ActionForm(FlaskForm):
    """Bare form used purely to carry a CSRF token for POST actions."""
    submit = SubmitField("Confirm")
