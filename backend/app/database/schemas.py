import uuid
from datetime import datetime

from fastapi_users import schemas
from pydantic import BaseModel, EmailStr


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
    role: str = "viewer"


class PointSchema(BaseModel):
    latitude: float
    longitude: float


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
    password: str
    province_id: uuid.UUID

class PendingOfficerRead(BaseModel):
    user_id: uuid.UUID
    email: str
    province_name_th: str
    province_path: str