import uuid
from datetime import datetime
from typing import Literal

from fastapi_users import schemas
from pydantic import BaseModel, EmailStr, Field


class UserRead(schemas.BaseUser[uuid.UUID]):
    pass

class UserCreate(schemas.BaseUserCreate):
    pass

class UserUpdate(schemas.BaseUserUpdate):
    pass


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

class UserRegionAssign(BaseModel):
    region_id: uuid.UUID
    # "admin" or "dispatcher" (web console / officer management). Required — there
    # is no read-only role to fall back to.
    role: Literal["admin", "dispatcher", "field_officer"]


class PointSchema(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class FirespotCreate(BaseModel):
    region_id: uuid.UUID
    detected_at: datetime
    location: PointSchema
    status: bool = False

class FirespotRead(BaseModel):
    id: uuid.UUID
    region_id: uuid.UUID
    detected_at: datetime
    location: PointSchema
    status: bool
    resolve_time: datetime | None

    class Config:
        from_attributes = True

class FirespotUpdate(BaseModel):
    status: bool | None = None
    resolve_time: datetime | None = None


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


class FieldOfficerCreate(BaseModel):
    user_id: uuid.UUID
    fire_id: uuid.UUID
    last_location: PointSchema | None = None
    note: str | None = None

class FieldOfficerRead(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    fire_id: uuid.UUID
    last_location: PointSchema | None
    last_updated: datetime
    note: str | None

    class Config:
        from_attributes = True

class FieldOfficerUpdate(BaseModel):
    last_location: PointSchema | None = None
    note: str | None = None

class ProvinceRead(BaseModel):
    id: uuid.UUID
    code: str
    name_th: str
    name_en: str | None
    path: str
    class Config:
        from_attributes = True

class OfficerRegister(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    province_code: str = Field(max_length=32)  # stable Region.code (e.g. "p50")
    name: str | None = Field(default=None, max_length=120)

class PendingOfficerRead(BaseModel):
    user_id: uuid.UUID
    email: str
    name: str | None
    province_name_th: str
    province_path: str


class PushTokenRegister(BaseModel):
    token: str = Field(min_length=1, max_length=4096)
    platform: str | None = None  # "android" | "ios" | "web"


class PushTokenDelete(BaseModel):
    token: str