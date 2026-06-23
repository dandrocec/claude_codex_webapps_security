"""WTForms definitions.

Flask-WTF supplies CSRF protection automatically for every form, and the
validators below enforce server-side input validation. Output is escaped by
Jinja2 autoescaping at render time.
"""

from __future__ import annotations

import re

from flask_wtf import FlaskForm
from flask_wtf.file import FileAllowed, FileField, FileRequired, FileSize
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
    Optional,
    Regexp,
    ValidationError,
)

# Skills: letters, digits, spaces, +, #, ., - separated by commas.
_SKILL_RE = re.compile(r"^[A-Za-z0-9 +#.\-]+$")


class RegisterForm(FlaskForm):
    email = StringField(
        "Email", validators=[DataRequired(), Email(), Length(max=254)]
    )
    full_name = StringField(
        "Full name", validators=[DataRequired(), Length(min=1, max=120)]
    )
    password = PasswordField(
        "Password",
        validators=[
            DataRequired(),
            Length(min=12, max=128, message="Use at least 12 characters."),
        ],
    )
    confirm = PasswordField(
        "Confirm password",
        validators=[DataRequired(), EqualTo("password", message="Passwords must match.")],
    )
    role = SelectField(
        "I am a",
        choices=[("candidate", "Candidate"), ("recruiter", "Recruiter")],
        validators=[DataRequired()],
    )
    submit = SubmitField("Create account")


class LoginForm(FlaskForm):
    email = StringField("Email", validators=[DataRequired(), Email(), Length(max=254)])
    password = PasswordField("Password", validators=[DataRequired(), Length(max=128)])
    remember = BooleanField("Remember me")
    submit = SubmitField("Log in")


class ProfileForm(FlaskForm):
    full_name = StringField(
        "Full name", validators=[DataRequired(), Length(min=1, max=120)]
    )
    headline = StringField("Headline", validators=[Optional(), Length(max=160)])
    location = StringField("Location", validators=[Optional(), Length(max=120)])
    bio = TextAreaField("About you", validators=[Optional(), Length(max=4000)])
    skills = StringField(
        "Skills (comma separated)",
        validators=[
            Optional(),
            Length(max=600),
            Regexp(
                _SKILL_RE,
                message="Skills may contain letters, numbers, spaces and + # . - only.",
            ),
        ],
    )
    submit = SubmitField("Save profile")


class ResumeForm(FlaskForm):
    resume = FileField(
        "Resume",
        validators=[
            FileRequired(),
            FileAllowed(["pdf", "doc", "docx"], "PDF or Word documents only."),
            FileSize(max_size=5 * 1024 * 1024, message="Maximum file size is 5 MB."),
        ],
    )
    submit = SubmitField("Upload resume")


class SearchForm(FlaskForm):
    class Meta:
        csrf = False  # read-only GET search; no state change, so no CSRF needed.

    skill = StringField(
        "Skill",
        validators=[
            Optional(),
            Length(max=60),
            Regexp(_SKILL_RE, message="Invalid characters in search term."),
        ],
    )
    submit = SubmitField("Search")
