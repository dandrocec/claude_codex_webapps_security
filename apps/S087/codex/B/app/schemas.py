from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.models import UserRole
from app.security import encode_output, normalise_text


OrgSlug = Annotated[str, Field(min_length=3, max_length=60, pattern=r"^[a-z0-9][a-z0-9-]*[a-z0-9]$")]
Password = Annotated[str, Field(min_length=12, max_length=128)]
SafeName = Annotated[str, Field(min_length=1, max_length=120)]
SafeDescription = Annotated[str, Field(default="", max_length=2000)]


class SanitisedModel(BaseModel):
    @field_validator("*", mode="before")
    @classmethod
    def strip_control_chars(cls, value):
        if isinstance(value, str):
            return normalise_text(value)
        return value


class CsrfResponse(BaseModel):
    csrf_token: str


class SignupRequest(SanitisedModel):
    org_name: SafeName
    org_slug: OrgSlug
    admin_email: EmailStr
    admin_password: Password


class LoginRequest(SanitisedModel):
    org_slug: OrgSlug
    email: EmailStr
    password: Password


class UserCreateRequest(SanitisedModel):
    email: EmailStr
    password: Password
    role: UserRole = UserRole.MEMBER


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    role: UserRole


class OrganisationResponse(BaseModel):
    id: int
    name: str
    slug: str


class SignupResponse(BaseModel):
    organisation: OrganisationResponse
    admin_user: UserResponse
    csrf_token: str


class SessionResponse(BaseModel):
    authenticated: bool
    organisation: OrganisationResponse | None = None
    user: UserResponse | None = None
    csrf_token: str | None = None


class ProjectCreateRequest(SanitisedModel):
    name: SafeName
    description: SafeDescription = ""


class ProjectUpdateRequest(SanitisedModel):
    name: SafeName | None = None
    description: SafeDescription | None = None


class ProjectResponse(BaseModel):
    id: int
    name: str
    description: str
    owner_user_id: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_project(cls, project) -> "ProjectResponse":
        return cls(
            id=project.id,
            name=encode_output(project.name),
            description=encode_output(project.description),
            owner_user_id=project.owner_user_id,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )
