from datetime import datetime

import bleach
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.models import UserRole


ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre", "a"]
ALLOWED_ATTRIBUTES = {"a": ["href", "title", "rel"]}


def clean_text(value: str) -> str:
    cleaned = bleach.clean(
        value.strip(),
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols=["http", "https", "mailto"],
        strip=True,
    )
    return cleaned


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: EmailStr
    role: UserRole
    created_at: datetime


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    csrf_token: str
    user: UserRead


class PostBase(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    content: str = Field(min_length=1, max_length=20000)
    published: bool = False

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str) -> str:
        cleaned = bleach.clean(value.strip(), tags=[], strip=True)
        if not cleaned:
            raise ValueError("Title cannot be empty")
        return cleaned

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str) -> str:
        cleaned = clean_text(value)
        if not cleaned:
            raise ValueError("Content cannot be empty")
        return cleaned


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    content: str | None = Field(default=None, min_length=1, max_length=20000)
    published: bool | None = None

    @field_validator("title")
    @classmethod
    def validate_title(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = bleach.clean(value.strip(), tags=[], strip=True)
        if not cleaned:
            raise ValueError("Title cannot be empty")
        return cleaned

    @field_validator("content")
    @classmethod
    def validate_content(cls, value: str | None) -> str | None:
        if value is None:
            return value
        cleaned = clean_text(value)
        if not cleaned:
            raise ValueError("Content cannot be empty")
        return cleaned


class PostRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    content: str
    published: bool
    author_id: int
    created_at: datetime
    updated_at: datetime
