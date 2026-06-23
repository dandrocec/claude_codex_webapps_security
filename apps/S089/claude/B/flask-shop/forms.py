"""WTForms definitions.

These give us server-side validation of every user-supplied value and, via
Flask-WTF, automatic CSRF tokens on all state-changing POST requests.
"""
from flask_wtf import FlaskForm
from wtforms import StringField, PasswordField, IntegerField, HiddenField
from wtforms.validators import (
    DataRequired, Email, Length, EqualTo, NumberRange, Regexp,
)


class RegisterForm(FlaskForm):
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=254)],
    )
    password = PasswordField(
        "Password",
        # 12..72: bcrypt's effective input limit is 72 bytes.
        validators=[DataRequired(), Length(min=12, max=72)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", "Passwords must match.")],
    )


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=72)])


class AddToCartForm(FlaskForm):
    product_id = HiddenField(validators=[DataRequired()])
    quantity = IntegerField(
        "Quantity",
        default=1,
        validators=[DataRequired(), NumberRange(min=1, max=99)],
    )


class UpdateCartForm(FlaskForm):
    product_id = HiddenField(validators=[DataRequired()])
    # 0 means remove the line.
    quantity = IntegerField(validators=[DataRequired(), NumberRange(min=0, max=99)])


class CSRFOnlyForm(FlaskForm):
    """Bare form used to attach a CSRF token to simple action buttons."""
