import uuid
from fastapi_users import schemas
from pydantic import BaseModel

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