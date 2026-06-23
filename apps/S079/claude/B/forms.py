"""WTForms definitions.

Flask-WTF wraps every form with a CSRF token, so all POST submissions that use
these forms are CSRF-protected. The validators below perform server-side input
validation (length, format, range) regardless of any client-side checks.
"""
from flask_wtf import FlaskForm
from wtforms import (
    DateField,
    DecimalField,
    PasswordField,
    SelectField,
    StringField,
    TextAreaField,
)
from wtforms.validators import (
    DataRequired,
    Email,
    EqualTo,
    Length,
    NumberRange,
    Optional,
)


class RegisterForm(FlaskForm):
    email = StringField(
        "Email",
        validators=[DataRequired(), Email(), Length(max=255)],
    )
    password = PasswordField(
        "Password",
        validators=[DataRequired(), Length(min=8, max=1024)],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=255)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=1024)])


class ClientForm(FlaskForm):
    name = StringField("Name", validators=[DataRequired(), Length(max=200)])
    email = StringField("Email", validators=[Optional(), Email(), Length(max=255)])
    address = TextAreaField("Address", validators=[Optional(), Length(max=2000)])


class InvoiceForm(FlaskForm):
    """Top-level invoice fields. Line items are parsed and validated separately
    in the view because they are a dynamic, repeating set of inputs."""

    client_id = SelectField("Client", validators=[DataRequired()], coerce=int)
    number = StringField("Invoice number", validators=[DataRequired(), Length(max=50)])
    issue_date = DateField("Issue date", validators=[DataRequired()])
    due_date = DateField("Due date", validators=[Optional()])
    tax_rate = DecimalField(
        "Tax rate (%)",
        places=2,
        validators=[DataRequired(), NumberRange(min=0, max=100)],
    )
    status = SelectField(
        "Status",
        choices=[("draft", "Draft"), ("sent", "Sent"), ("paid", "Paid")],
        validators=[DataRequired()],
    )
    notes = TextAreaField("Notes", validators=[Optional(), Length(max=2000)])


class DeleteForm(FlaskForm):
    """Empty form used purely to carry a CSRF token for delete buttons."""
