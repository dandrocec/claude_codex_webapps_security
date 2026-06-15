"""WTForms definitions. Flask-WTF provides CSRF protection on every form."""
from __future__ import annotations

from flask_wtf import FlaskForm
from wtforms import IntegerField, PasswordField, StringField
from wtforms.validators import (
    EqualTo,
    InputRequired,
    Length,
    NumberRange,
    Regexp,
    ValidationError,
)

USERNAME_RE = r"^[A-Za-z0-9_.-]+$"
SKU_RE = r"^[A-Za-z0-9_.-]+$"


class RegisterForm(FlaskForm):
    username = StringField(
        "Username",
        validators=[
            InputRequired(),
            Length(min=3, max=64),
            Regexp(USERNAME_RE, message="Use letters, numbers, and . _ - only."),
        ],
    )
    password = PasswordField(
        "Password",
        validators=[InputRequired(), Length(min=12, max=200)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[InputRequired(), EqualTo("password", message="Passwords must match.")],
    )


class LoginForm(FlaskForm):
    username = StringField("Username", validators=[InputRequired(), Length(max=64)])
    password = PasswordField("Password", validators=[InputRequired(), Length(max=200)])


class ItemForm(FlaskForm):
    name = StringField("Name", validators=[InputRequired(), Length(min=1, max=120)])
    sku = StringField(
        "SKU",
        validators=[
            InputRequired(),
            Length(min=1, max=64),
            Regexp(SKU_RE, message="Use letters, numbers, and . _ - only."),
        ],
    )
    quantity = IntegerField(
        "Quantity",
        validators=[InputRequired(), NumberRange(min=0, max=1_000_000_000)],
    )
    location = StringField("Location", validators=[Length(max=120)])
    low_stock_threshold = IntegerField(
        "Low-stock threshold",
        validators=[InputRequired(), NumberRange(min=0, max=1_000_000_000)],
    )


class AdjustForm(FlaskForm):
    # Positive to add stock, negative to remove; result is clamped server-side.
    delta = IntegerField(
        "Adjust by",
        validators=[InputRequired(), NumberRange(min=-1_000_000_000, max=1_000_000_000)],
    )

    def validate_delta(self, field):
        if field.data == 0:
            raise ValidationError("Enter a non-zero amount.")
