from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models import UserRole


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1)


class UserRead(BaseModel):
    id: int
    username: str
    role: UserRole

    model_config = ConfigDict(from_attributes=True)


class PostBase(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1)
    published: bool = False


class PostCreate(PostBase):
    pass


class PostUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1)
    published: bool | None = None


class PostRead(PostBase):
    id: int
    created_at: datetime
    updated_at: datetime
    author: UserRead

    model_config = ConfigDict(from_attributes=True)
