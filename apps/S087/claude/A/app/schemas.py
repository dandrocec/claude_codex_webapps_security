from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from .models import Role


# ---- Auth / signup ----

class SignupRequest(BaseModel):
    """Creates a new organisation together with its first (admin) user."""

    org_name: str = Field(min_length=1, max_length=200)
    org_slug: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$")
    admin_email: EmailStr
    # 72 bytes is bcrypt's hard limit on password length.
    admin_password: str = Field(min_length=8, max_length=72)


class LoginRequest(BaseModel):
    org_slug: str
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ---- Organisations ----

class OrganisationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    slug: str
    created_at: datetime


# ---- Users ----

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: Role = Role.member


class UserRoleUpdate(BaseModel):
    role: Role


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    email: EmailStr
    role: Role
    is_active: bool
    created_at: datetime


# ---- Projects (sample resource) ----

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    org_id: int
    name: str
    description: str
    created_by: int
    created_at: datetime
