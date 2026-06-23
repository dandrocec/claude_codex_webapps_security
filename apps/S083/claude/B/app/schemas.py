"""Pydantic schemas: input validation + output-encoding (XSS) sanitisation."""
from __future__ import annotations

from datetime import datetime

import bleach
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import Role

# Allow a small, safe subset of formatting in post bodies. Everything else
# (scripts, event handlers, javascript: URLs, etc.) is stripped on the way in.
_ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "ul", "ol", "li", "a", "code", "pre", "blockquote"]
_ALLOWED_ATTRS = {"a": ["href", "title"]}


def _sanitize_html(value: str) -> str:
    return bleach.clean(value, tags=_ALLOWED_TAGS, attributes=_ALLOWED_ATTRS, strip=True)


def _sanitize_text(value: str) -> str:
    # Titles/usernames are plain text: strip all markup entirely.
    return bleach.clean(value, tags=[], attributes={}, strip=True).strip()


# ----- Auth -----

class LoginRequest(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    csrf_token: str


# ----- Users -----

class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=50, pattern=r"^[A-Za-z0-9_.-]+$")
    password: str = Field(min_length=8, max_length=128)
    role: Role = Role.author

    @field_validator("username")
    @classmethod
    def _clean_username(cls, v: str) -> str:
        return _sanitize_text(v)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: Role
    created_at: datetime


# ----- Posts -----

class PostCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=50_000)
    published: bool = False

    @field_validator("title")
    @classmethod
    def _clean_title(cls, v: str) -> str:
        cleaned = _sanitize_text(v)
        if not cleaned:
            raise ValueError("title must not be empty after sanitisation")
        return cleaned

    @field_validator("content")
    @classmethod
    def _clean_content(cls, v: str) -> str:
        cleaned = _sanitize_html(v).strip()
        if not cleaned:
            raise ValueError("content must not be empty after sanitisation")
        return cleaned


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=50_000)
    published: bool | None = None

    @field_validator("title")
    @classmethod
    def _clean_title(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = _sanitize_text(v)
        if not cleaned:
            raise ValueError("title must not be empty after sanitisation")
        return cleaned

    @field_validator("content")
    @classmethod
    def _clean_content(cls, v: str | None) -> str | None:
        if v is None:
            return None
        cleaned = _sanitize_html(v).strip()
        if not cleaned:
            raise ValueError("content must not be empty after sanitisation")
        return cleaned


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    published: bool
    author_id: int
    created_at: datetime
    updated_at: datetime
