import re
import uuid
from enum import StrEnum
from typing import Annotated

from fastapi_users import schemas
from pydantic import BaseModel, Field, StringConstraints

Username = Annotated[
    str, StringConstraints(min_length=3, max_length=32, pattern=r"^[A-Za-z0-9._@+-]+$")
]

_USERNAME_RE = re.compile(r"^[A-Za-z0-9._@+-]{3,32}$")


class UserRole(StrEnum):
    ADMIN = "admin"
    DISPATCHER = "dispatcher"
    FIELD_OFFICER = "field_officer"


def valid_username(value: str | None) -> bool:
    return bool(_USERNAME_RE.match(value or ""))


class UserRead(schemas.BaseUser[uuid.UUID]):
    email: str
    division: str | None = None


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
    minutes: float = Field(gt=0, le=1440)


class PushTokenRegister(BaseModel):
    token: str = Field(min_length=1, max_length=4096)
    platform: str | None = None


class PushTokenDelete(BaseModel):
    token: str


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=1, max_length=512)
