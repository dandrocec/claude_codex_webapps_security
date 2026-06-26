from datetime import datetime

from pydantic import BaseModel, Field


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=40, pattern=r"^[a-zA-Z0-9_]+$")
    display_name: str = Field(min_length=1, max_length=80)


class UserOut(BaseModel):
    id: int
    username: str
    display_name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PostCreate(BaseModel):
    user_id: int
    body: str = Field(min_length=1, max_length=500)


class FollowCreate(BaseModel):
    follower_id: int
    followee_id: int


class LinkPreviewOut(BaseModel):
    url: str
    title: str
    description: str
    image_url: str
    status: str

    model_config = {"from_attributes": True}


class PostOut(BaseModel):
    id: int
    user_id: int
    body: str
    created_at: datetime
    author: UserOut
    previews: list[LinkPreviewOut] = []

    model_config = {"from_attributes": True}
