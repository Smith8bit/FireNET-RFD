import re
import uuid
from enum import StrEnum
from typing import Annotated

from fastapi_users import schemas
from pydantic import BaseModel, Field, StringConstraints

# fastapi-users has no concept of a username — its identity field is always called
# "email". FireNET repurposes that slot to store a short alphanumeric handle instead
# of a real email address. This type enforces the handle constraints in one place
# so UserRead, UserCreate, and UserUpdate all stay in sync.
Username = Annotated[
    str, StringConstraints(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9._@+-]+$")
]

# Pre-compiled at module load for use outside Pydantic validation (e.g., seed helpers).
_USERNAME_RE = re.compile(r"^[A-Za-z0-9._@+-]{3,32}$")


# StrEnum serialises directly to its string value in JSON responses,
# avoiding the need for .value access throughout the codebase.
class UserRole(StrEnum):
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    FIELD_OFFICER = "field_officer"


def valid_username(value: str | None) -> bool:
    """Return True if value satisfies the Username constraints; None is always False."""
    return bool(_USERNAME_RE.match(value or ""))


class UserRead(schemas.BaseUser[uuid.UUID]):
    email: Username
    division: str | None = None


class UserCreate(schemas.BaseUserCreate):
    # Field is named "email" because fastapi-users does not support a username field;
    # we override the type to Username to enforce handle validation instead.
    email: Username
    division: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    email: Username | None = None
    division: str | None = None


class RegionRead(BaseModel):
    id: uuid.UUID
    code: str
    name_th: str
    name_en: str | None
    level: str
    path: str       # dot-separated LTREE path, e.g. "th.r1.p50"
    parent_id: uuid.UUID | None

    class Config:
        from_attributes = True


class FireAssign(BaseModel):
    # None signals an unassign operation; the handler must handle both cases.
    fire_id: uuid.UUID | None = None


class FireFalseReport(BaseModel):
    note: str | None = None


class OfficerStatusUpdate(BaseModel):
    # All fields are optional to support partial PATCH semantics.
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    active: bool | None = None


class ProvinceRead(BaseModel):
    id: uuid.UUID
    code: str
    name_th: str
    name_en: str | None
    path: str

    class Config:
        from_attributes = True


class OfficerRegister(BaseModel):
    username: Username
    password: str = Field(min_length=8, max_length=128)
    province_code: str = Field(max_length=32)
    name: str | None = Field(default=None, max_length=120)
    division: str | None = Field(default=None, max_length=120)


class OfficerProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    division: str | None = Field(default=None, max_length=120)


class RegionChangeCreate(BaseModel):
    province_code: str = Field(max_length=32)


class LocationPollUpdate(BaseModel):
    # le=1440 caps the interval at 24 hours to prevent accidental permanent silence.
    minutes: float = Field(gt=0, le=1440)


class PushTokenRegister(BaseModel):
    # FCM/APNs tokens can reach ~4096 chars; max_length guards against oversized payloads.
    token: str = Field(min_length=1, max_length=4096)
    platform: str | None = None


class PushTokenDelete(BaseModel):
    token: str


class RefreshRequest(BaseModel):
    # max_length=512 guards against oversized payloads before any hashing occurs.
    refresh_token: str = Field(min_length=1, max_length=512)
