import asyncio
import json
from io import BytesIO

from fastapi import HTTPException, UploadFile, status as http_status
from minio import Minio

from .config import get_settings

settings = get_settings()

# Lazily-initialized module-level singleton: avoids constructing a Minio client (and its
# connection pool) at import time, and avoids re-creating one on every call.
_client: Minio | None = None


def client() -> Minio:
    """Return the shared Minio (S3-compatible) client, creating it on first use."""
    global _client
    if _client is None:
        _client = Minio(
            settings.S3_ENDPOINT,
            access_key=settings.S3_ACCESS_KEY,
            secret_key=settings.S3_SECRET_KEY,
            secure=settings.S3_SECURE,
        )
    return _client


async def ensure_bucket() -> None:
    """Create the configured bucket if it doesn't already exist (idempotent, called at boot).

    The `minio` SDK is synchronous/blocking, so every function in this module offloads its
    work to a thread via asyncio.to_thread to avoid blocking the event loop.
    """

    def _ensure() -> None:
        c = client()
        if not c.bucket_exists(settings.S3_BUCKET):
            c.make_bucket(settings.S3_BUCKET)

    await asyncio.to_thread(_ensure)


async def put_object(key: str, data: bytes, content_type: str) -> None:
    """Upload raw bytes to the bucket under `key`.

    Args:
        key: Object key (path) within the bucket.
        data: Raw object bytes; wrapped in BytesIO since the Minio SDK expects a file-like
            stream, and its length is passed explicitly because BytesIO doesn't expose a
            size the SDK can introspect on its own.
        content_type: MIME type stored as object metadata.
    """
    await asyncio.to_thread(
        lambda: client().put_object(
            settings.S3_BUCKET, key, BytesIO(data), len(data), content_type=content_type
        )
    )


async def get_object(key: str) -> bytes:
    """Download and fully buffer the object at `key` into memory.

    Args:
        key: Object key within the bucket.
    Returns:
        The object's raw bytes.
    Note:
        The response stream is closed and its connection released in a finally block —
        required by the Minio SDK to return the underlying HTTP connection to its pool,
        otherwise repeated calls would leak connections.
    """

    def _get() -> bytes:
        resp = client().get_object(settings.S3_BUCKET, key)
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    return await asyncio.to_thread(_get)


async def remove_objects(keys: list[str]) -> None:
    """Best-effort delete of multiple objects; a failure on one key does not abort the rest.

    Args:
        keys: Object keys to delete.
    Note:
        Deletes are looped individually (rather than using a bulk-delete API call) so each
        key's failure is isolated and merely logged, since this is used for cleanup/sweep
        paths where partial success is acceptable and callers don't need per-key results.
    """

    def _remove() -> None:
        c = client()
        for key in keys:
            try:
                c.remove_object(settings.S3_BUCKET, key)
            except Exception as exc:
                print(f"[storage] failed to remove {key}: {exc}")

    await asyncio.to_thread(_remove)


async def list_keys(prefix: str) -> list[str]:
    """List all object keys under `prefix`.

    Args:
        prefix: Key prefix to filter by (e.g. a fire/resolution ID folder).
    Returns:
        Object keys matching the prefix; recursive=True so it flattens any nested
        "directory" structure into a single list rather than paginating by folder level.
    """

    def _list() -> list[str]:
        return [
            obj.object_name
            for obj in client().list_objects(
                settings.S3_BUCKET, prefix=prefix, recursive=True
            )
        ]

    return await asyncio.to_thread(_list)


# Maps sniffed MIME type -> canonical file extension used when constructing object keys,
# so stored filenames stay consistent regardless of what extension the client sent.
IMAGE_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


async def read_capped(upload: UploadFile, max_bytes: int) -> bytes:
    """Read an uploaded file into memory while enforcing a hard size limit.

    Args:
        upload: The incoming multipart file upload.
        max_bytes: Maximum total size allowed, in bytes.
    Returns:
        The full file contents as bytes.
    Raises:
        HTTPException(400): If the stream exceeds `max_bytes`.
    Note:
        Reads in fixed-size chunks (settings.IMAGE_CHUNK_BYTES) and checks the running total
        after each chunk, so an oversized upload is rejected as soon as the limit is crossed
        rather than buffering the entire (potentially huge) file into memory first.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(settings.IMAGE_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "photo too large")
        chunks.append(chunk)
    return b"".join(chunks)


def sniff_image(data: bytes) -> str | None:
    """Identify an image's MIME type from its magic-byte signature.

    Args:
        data: Raw file bytes.
    Returns:
        The detected MIME type, or None if it doesn't match a known signature.
    Note:
        Trusts file content over any client-supplied Content-Type/filename, since those are
        trivially spoofable; only the three formats in IMAGE_EXT are accepted, which also
        acts as an implicit allowlist against uploading arbitrary/executable file types.
    """
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def parse_image_gps(image_gps: str | None, count: int) -> list[dict[str, float] | None]:
    """Parse a client-supplied JSON array of per-image GPS coordinates.

    Args:
        image_gps: JSON-encoded string, expected to be a list of
            {"latitude": float, "longitude": float} objects (or null entries), one per
            uploaded image; may be None/empty if the client sent no GPS data at all.
        count: Number of images actually uploaded — the output is normalized to exactly
            this length regardless of how many entries the client sent.
    Returns:
        A list of length `count` where each element is either a coordinate dict or None.
        Missing entries are padded with None; entries with the wrong shape, non-numeric
        values, or out-of-range lat/lng are silently coerced to None rather than rejected,
        since GPS metadata is optional/best-effort and shouldn't block the whole upload.
    Raises:
        HTTPException(400): If `image_gps` is present but not valid JSON, or not a JSON list.
    """
    if not image_gps:
        return [None] * count
    try:
        parsed = json.loads(image_gps)
        assert isinstance(parsed, list)
    except (ValueError, AssertionError):
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "invalid image_gps")
    # Truncate/pad to exactly `count` entries so downstream code can zip this 1:1 with the
    # uploaded images without worrying about a client sending a mismatched array length.
    parsed = parsed[:count] + [None] * (count - len(parsed))
    out: list[dict[str, float] | None] = []
    for item in parsed:
        if isinstance(item, dict) and "latitude" in item and "longitude" in item:
            try:
                lat = float(item["latitude"])
                lng = float(item["longitude"])
            except (TypeError, ValueError):
                out.append(None)
                continue
            out.append(
                {"latitude": lat, "longitude": lng}
                if -90 <= lat <= 90 and -180 <= lng <= 180
                else None
            )
        else:
            out.append(None)
    return out
