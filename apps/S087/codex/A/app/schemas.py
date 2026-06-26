from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models import UserRole


class OrganisationSignup(BaseModel):
    org_name: str = Field(min_length=1, max_length=200)
    org_slug: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$")
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=128)


class OrganisationOut(BaseModel):
    id: int
    name: str
    slug: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: UserRole = UserRole.member


class UserOut(BaseModel):
    id: int
    organisation_id: int
    email: EmailStr
    role: UserRole
    created_at: datetime

    model_config = {"from_attributes": True}


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class ProjectOut(BaseModel):
    id: int
    organisation_id: int
    owner_id: int | None
    name: str
    description: str | None
    created_at: datetime

    model_config = {"from_attributes": True}
