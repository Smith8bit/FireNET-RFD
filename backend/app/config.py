import hashlib
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Resolve the env file against the backend package, not the process CWD, so the
# same secrets load whether the app is started from backend/ or the test suite
# is run from the repo root. (config.py -> app/ -> backend/.env)
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=str(_ENV_FILE), extra="ignore")

    DATABASE_URL: str = "postgresql+asyncpg://tfms:tfms@localhost:5432/tfms"

    # Connection pool, per worker process (applied in database/db.py). To put
    # PgBouncer (transaction pooling) in front of Postgres, set DB_PGBOUNCER=true —
    # that disables SQLAlchemy's prepared-statement cache and uses unique statement
    # names, which transaction pooling otherwise breaks. Keep the per-worker pool
    # modest; PgBouncer multiplexes to Postgres.
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 1800
    DB_PGBOUNCER: bool = False
    # No default: a missing JWT_SECRET must crash the app at boot, never silently
    # fall back to a value that lives in source control (a public signing key
    # lets anyone forge an auth cookie for any account, including the superuser).
    # It is also the master secret the password-reset / verification token secrets
    # are derived from — see auth.authen.
    JWT_SECRET: str
    # Secure by default: only an explicit env override may downgrade this, and the
    # cookie carries the session token, so it must not ride over plain HTTP.
    COOKIE_SECURE: bool = True
    COOKIE_MAX_AGE: int = 86400
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    INITIAL_SUPERUSER_EMAIL: str = "admin@forest.com"
    # No default: the bootstrap superuser password must come from the environment.
    INITIAL_SUPERUSER_PASSWORD: str
    # Provision a real dispatcher account per regional office / province at startup
    # (random passwords, credentials written to a gitignored CSV). Off by default;
    # turn on once to provision, distribute the CSV, then turn back off.
    SEED_REGIONAL_ACCOUNTS: bool = False

    # Wildfire ingest.
    # When the feed is COLOCATED on this same server, point this at the internal /
    # loopback address (e.g. http://127.0.0.1:<port>/firemap/getdb.php) — a box
    # fetching its own *public* hostname often fails on NAT hairpin and silently
    # ingests nothing. Caveat: the fetch sends a browser UA + Referer to clear the
    # feed's mod_security (see db_control/firefetch.py); switching to an internal
    # URL changes the Host header, so if mod_security keys on Host/Referer it may
    # block — keep https with a valid cert, or relax those rules for the loopback.
    WILDFIRE_API_URL: str = "https://wildfire.forest.go.th/firemap/getdb.php"
    INGEST_ENABLED: bool = True
    INGEST_INTERVAL_MINUTES: int = 60
    INGEST_LOOKBACK_DAYS: int = 1  # re-fetch yesterday too, so a midnight gap can't drop fires
    INGEST_TIMEZONE: str = "Asia/Bangkok"

    # an officer stops showing as online after this long without a location update
    OFFICER_ONLINE_TTL_MINUTES: int = 15

    # admin officer lists (positions / online status) are refreshed on this cadence
    # rather than per location ping — see ws/pg_listener.py. Routine 5-min pings from
    # 40k officers must not drive a per-change full-fleet broadcast.
    OFFICER_REFRESH_INTERVAL_SECONDS: int = 20

    # Map officer pushes are bounded to the admin's current viewport (bbox) and
    # capped: at 50k officers a national-scope admin must never be sent — nor the
    # browser asked to render — the whole fleet. Officers are only meaningful
    # zoomed in; when a viewport holds more than this, the freshest N are returned.
    OFFICER_MAP_MAX: int = 500

    # default fire view spans this many days back, inclusive of today (1 = today only)
    FIRE_DISPLAY_DAYS: int = 2
    
    # unresolved fires auto-expire (and release their officer) after this many days
    FIRE_EXPIRE_DAYS: int = 3

    # Fire-resolution evidence storage (S3-compatible / MinIO)
    S3_ENDPOINT: str = "localhost:9000"
    S3_ACCESS_KEY: str = "tfms"
    # No default: object-storage credentials must come from the environment.
    S3_SECRET_KEY: str
    S3_BUCKET: str = "tfms-fire-evidence"
    S3_SECURE: bool = False
    RESOLVE_MAX_IMAGES: int = 3
    RESOLVE_MAX_IMAGE_MB: int = 5
    RESOLVE_NOTE_MAX_CHARS: int = 2000

    # Push notifications (Firebase Cloud Messaging, direct via firebase-admin).
    # Until FCM_CREDENTIALS_FILE points at a service-account JSON, sends are
    # logged and skipped (the rest of the wiring works without credentials).
    PUSH_ENABLED: bool = True
    FCM_CREDENTIALS_FILE: str = ""  # path to the Firebase service-account JSON


@lru_cache
def get_settings() -> Settings:
    return Settings()


def derive_secret(label: str) -> str:
    """Domain-separated secret derived from the master JWT_SECRET.

    Gives the password-reset and email-verification flows their own signing keys
    without extra env vars: a token minted for one purpose can't be replayed for
    another, and none of them is the raw JWT_SECRET."""
    return hashlib.sha256(f"{label}:{get_settings().JWT_SECRET}".encode()).hexdigest()