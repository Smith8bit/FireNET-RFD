import re
import uuid
from enum import StrEnum
from typing import Annotated

from fastapi_users import schemas
from pydantic import BaseModel, Field, StringConstraints

# Login identity is a free-form username, not an email. fastapi-users hardwires the
# identity column/field name to `email`, so we keep that name internally (it never
# surfaces to users) but accept a plain username: letters + digits + . _ - @ +, 3–32 chars.
Username = Annotated[str, StringConstraints(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9._@+-]+$")]

_USERNAME_RE = re.compile(r"^[A-Za-z0-9._@+-]{3,32}$")


class UserRole(StrEnum):
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    FIELD_OFFICER = "field_officer"


def valid_username(value: str | None) -> bool:
    """Same rule as the Username type, for hand-rolled WS validation (no pydantic there)."""
    return bool(_USERNAME_RE.match(value or ""))


class UserRead(schemas.BaseUser[uuid.UUID]):
    email: str  # username value; relax BaseUser's EmailStr so non-emails read back
    division: str | None = None  # สังกัด

class UserCreate(schemas.BaseUserCreate):
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
    path: str
    parent_id: uuid.UUID | None

    class Config:
        from_attributes = True

class FireAssign(BaseModel):
    fire_id: uuid.UUID | None = None


class FireFalseReport(BaseModel):
    note: str | None = None


class OfficerStatusUpdate(BaseModel):
    # coords are optional so an officer can go offline without a GPS fix.
    # active is optional too: a heartbeat sends coords only and must NOT change
    # the online flag (avoids an in-flight poll re-activating a just-toggled-off officer).
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
    province_code: str = Field(max_length=32)  # stable Region.code (e.g. "p50")
    name: str | None = Field(default=None, max_length=120)
    division: str | None = Field(default=None, max_length=120)  # สังกัด


class OfficerProfileUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    division: str | None = Field(default=None, max_length=120)  # สังกัด


class RegionChangeCreate(BaseModel):
    province_code: str = Field(max_length=32)  # stable Region.code (e.g. "p50")


class LocationPollUpdate(BaseModel):
    # superuser-set mobile location-poll cadence, in minutes. Stored as-is; the
    # read endpoint clamps to the configured floor (0.5 → still served as the 1-min floor).
    minutes: float = Field(gt=0, le=1440)


class PushTokenRegister(BaseModel):
    token: str = Field(min_length=1, max_length=4096)
    platform: str | None = None  # "android" | "ios" | "web"


class PushTokenDelete(BaseModel):
    token: str


# Mobile bearer flow carries the refresh token in the JSON body (web uses an
# httpOnly cookie instead). 64 raw bytes url-safe-encoded is ~43 chars; cap loose.
class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)
