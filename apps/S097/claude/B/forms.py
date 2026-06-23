"""WTForms definitions.

WTForms gives us server-side validation and, combined with Flask-WTF's
CSRFProtect, a CSRF token on every form. Output is escaped by Jinja2's
autoescaping when these values are rendered back.
"""
from flask_wtf import FlaskForm
from wtforms import (
    StringField,
    PasswordField,
    TextAreaField,
    IntegerField,
    DecimalField,
    SelectField,
    BooleanField,
)
from wtforms.validators import (
    DataRequired,
    Email,
    Length,
    EqualTo,
    NumberRange,
    Regexp,
)


class RegisterForm(FlaskForm):
    name = StringField("Name", validators=[DataRequired(), Length(min=1, max=80)])
    email = StringField(
        "Email", validators=[DataRequired(), Email(), Length(max=255)]
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


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])


class AddToCartForm(FlaskForm):
    quantity = IntegerField(
        "Quantity", validators=[DataRequired(), NumberRange(min=1, max=99)], default=1
    )


class UpdateCartForm(FlaskForm):
    quantity = IntegerField(
        "Quantity", validators=[NumberRange(min=0, max=99)], default=1
    )


class CheckoutForm(FlaskForm):
    shipping_name = StringField(
        "Full name", validators=[DataRequired(), Length(min=1, max=120)]
    )
    shipping_address = TextAreaField(
        "Shipping address", validators=[DataRequired(), Length(min=5, max=500)]
    )


class ReviewForm(FlaskForm):
    rating = SelectField(
        "Rating",
        choices=[("5", "5 - Excellent"), ("4", "4 - Good"), ("3", "3 - Average"),
                 ("2", "2 - Poor"), ("1", "1 - Terrible")],
        validators=[DataRequired()],
    )
    body = TextAreaField("Review", validators=[Length(max=2000)])


class ProductForm(FlaskForm):
    name = StringField("Name", validators=[DataRequired(), Length(min=1, max=120)])
    description = TextAreaField("Description", validators=[Length(max=4000)])
    price = DecimalField(
        "Price (e.g. 19.99)",
        places=2,
        validators=[DataRequired(), NumberRange(min=0, max=1_000_000)],
    )
    stock = IntegerField(
        "Stock", validators=[DataRequired(), NumberRange(min=0, max=1_000_000)]
    )
    is_active = BooleanField("Active (visible in store)", default=True)


class OrderStatusForm(FlaskForm):
    status = SelectField(
        "Status",
        choices=[(s, s.title()) for s in
                 ("pending", "paid", "shipped", "delivered", "cancelled")],
        validators=[DataRequired()],
    )
