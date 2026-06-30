from fastapi import APIRouter

from .booking import router as booking_router
from .profile import router as profile_router
from .push_token import router as push_token_router
from .region_change import router as region_change_router
from .registration import router as registration_router
from .resolution import router as resolution_router
from .settings import router as settings_router

router = APIRouter()
router.include_router(registration_router)
router.include_router(settings_router)
router.include_router(profile_router)
router.include_router(booking_router)
router.include_router(resolution_router)
router.include_router(region_change_router)
router.include_router(push_token_router)
