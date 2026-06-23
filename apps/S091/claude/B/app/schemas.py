"""Pydantic request/response schemas. These enforce input validation."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import settings
from .security import valid_username


class RegisterIn(BaseModel):
    username: str = Field(min_length=3, max_length=30)
    password: str = Field(min_length=settings.MIN_PASSWORD_LENGTH, max_length=128)

    @field_validator("username")
    @classmethod
    def _username(cls, v: str) -> str:
        v = v.strip()
        if not valid_username(v):
            raise ValueError("username must be 3-30 chars: letters, digits, underscore")
        return v

    @field_validator("password")
    @classmethod
    def _password(cls, v: str) -> str:
        if len(v.encode("utf-8")) > settings.MAX_PASSWORD_BYTES:
            raise ValueError("password too long")
        return v


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=30)
    password: str = Field(min_length=1, max_length=128)


class PostIn(BaseModel):
    content: str = Field(min_length=1, max_length=settings.MAX_POST_LENGTH)

    @field_validator("content")
    @classmethod
    def _content(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content cannot be empty")
        return v


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    created_at: datetime


class PreviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    url: str
    status: str
    title: str | None = None
    description: str | None = None
    image_url: str | None = None


class PostOut(BaseModel):
    id: int
    content: str
    created_at: datetime
    author: UserOut
    previews: list[PreviewOut] = []
