import hashlib
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# .env lives one directory above this package (backend/.env), not next to this file.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    # extra="ignore" so unrelated env vars (e.g. shell/OS vars) don't raise validation errors.
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://firenet:firenet@localhost:5432/firenet"

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800
    DB_PGBOUNCER: bool = False
    # No default: pydantic-settings raises at startup if missing from env/.env, forcing
    # every deployment to supply its own secret rather than falling back to something guessable.
    JWT_SECRET: str
    COOKIE_SECURE: bool = True
    ACCESS_TOKEN_MAX_AGE: int = 3600
    REFRESH_TOKEN_MAX_AGE: int = 2592000
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    RATE_LIMIT_MAX: int = 10
    RATE_LIMIT_WINDOW_SECONDS: float = 60.0

    INITIAL_SUPERUSER_USERNAME: str = "adminRFD"
    # Required (no default) so a bootstrap admin account can never be created with a blank password.
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
    # Required: no safe default for a credential that grants write access to fire evidence storage.
    S3_SECRET_KEY: str
    S3_BUCKET: str = "firenet-fire-evidence"
    S3_SECURE: bool = False
    RESOLVE_MAX_IMAGES: int = 3
    RESOLVE_MAX_IMAGE_MB: int = 5
    RESOLVE_MAX_VIDEO_MB: int = 40
    RESOLVE_NOTE_MAX_CHARS: int = 2000
    RESOLVE_RETRY_MINUTES: int = 10
    IMAGE_CHUNK_BYTES: int = 65536

    PUSH_ENABLED: bool = True
    FCM_CREDENTIALS_FILE: str = ""


@lru_cache
def get_settings() -> Settings:
    """Return the process-wide Settings singleton.

    lru_cache (no maxsize args -> unbounded, but only ever called with no arguments)
    ensures the .env file is parsed once and the same instance is reused everywhere,
    avoiding repeated disk reads and guaranteeing all callers see identical config.
    """
    return Settings()


def derive_secret(label: str) -> str:
    """Deterministically derive a purpose-scoped secret from the master JWT secret.

    Args:
        label: A namespace string (e.g. "refresh", "csrf") identifying the secret's use.
    Returns:
        A hex-encoded SHA-256 digest, unique per label but reproducible across processes
        since it's a pure function of (label, JWT_SECRET) — avoids needing to store/rotate
        multiple independent secrets while still keeping different subsystems cryptographically
        isolated from one another.
    """
    return hashlib.sha256(f"{label}:{get_settings().JWT_SECRET}".encode()).hexdigest()