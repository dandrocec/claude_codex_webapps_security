"""Pydantic request/response schemas (API contract)."""
import datetime as dt
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=50)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    created_at: Optional[dt.datetime] = None


class FollowCreate(BaseModel):
    target_id: int


class PostCreate(BaseModel):
    author_id: int
    content: str = Field(min_length=1, max_length=2000)


class LinkPreviewOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    title: Optional[str] = None
    description: Optional[str] = None
    image: Optional[str] = None
    status: str


class PostOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    author_id: int
    author_username: Optional[str] = None
    content: str
    created_at: Optional[dt.datetime] = None
    previews: List[LinkPreviewOut] = []
