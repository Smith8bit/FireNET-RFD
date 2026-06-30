import hashlib
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://firenet:firenet@localhost:5432/firenet"

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800
    DB_PGBOUNCER: bool = False
    JWT_SECRET: str
    COOKIE_SECURE: bool = True
    ACCESS_TOKEN_MAX_AGE: int = 3600
    REFRESH_TOKEN_MAX_AGE: int = 2592000
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    RATE_LIMIT_MAX: int = 10
    RATE_LIMIT_WINDOW_SECONDS: float = 60.0

    INITIAL_SUPERUSER_USERNAME: str = "adminRFD"
    INITIAL_SUPERUSER_PASSWORD: str
    SEED_REGIONAL_ACCOUNTS: bool = False

    WILDFIRE_API_URL: str = "https://wildfire.forest.go.th/firemap/getdb.php"
    INGEST_ENABLED: bool = True
    INGEST_INTERVAL_MINUTES: int = 60
    INGEST_LOOKBACK_DAYS: int = 1
    INGEST_TIMEZONE: str = "Asia/Bangkok"

    LOCATION_POLL_DEFAULT_MINUTES: float = 5
    LOCATION_POLL_MIN_MINUTES: float = 1
    LOCATION_POLL_MAX_MINUTES: float = 10

    OFFICER_ONLINE_TTL_MINUTES: int = 20
    OFFICER_REFRESH_INTERVAL_SECONDS: int = 20
    OFFICER_MAP_MAX: int = 500

    FIRE_DISPLAY_DAYS: int = 2
    FIRE_EXPIRE_DAYS: int = 3

    S3_ENDPOINT: str = "localhost:9000"
    S3_ACCESS_KEY: str = "firenet"
    S3_SECRET_KEY: str
    S3_BUCKET: str = "firenet-fire-evidence"
    S3_SECURE: bool = False
    RESOLVE_MAX_IMAGES: int = 3
    RESOLVE_MAX_IMAGE_MB: int = 5
    RESOLVE_NOTE_MAX_CHARS: int = 2000
    RESOLVE_RETRY_MINUTES: int = 10
    IMAGE_CHUNK_BYTES: int = 65536

    PUSH_ENABLED: bool = True
    FCM_CREDENTIALS_FILE: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()


def derive_secret(label: str) -> str:
    return hashlib.sha256(f"{label}:{get_settings().JWT_SECRET}".encode()).hexdigest()