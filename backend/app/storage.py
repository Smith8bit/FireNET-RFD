import asyncio
import json
from io import BytesIO

from fastapi import HTTPException, UploadFile, status as http_status
from minio import Minio

from .config import get_settings

settings = get_settings()

_client: Minio | None = None


def client() -> Minio:
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
    def _ensure() -> None:
        c = client()
        if not c.bucket_exists(settings.S3_BUCKET):
            c.make_bucket(settings.S3_BUCKET)

    await asyncio.to_thread(_ensure)


async def put_object(key: str, data: bytes, content_type: str) -> None:
    await asyncio.to_thread(
        lambda: client().put_object(
            settings.S3_BUCKET, key, BytesIO(data), len(data), content_type=content_type
        )
    )


async def get_object(key: str) -> bytes:
    def _get() -> bytes:
        resp = client().get_object(settings.S3_BUCKET, key)
        try:
            return resp.read()
        finally:
            resp.close()
            resp.release_conn()

    return await asyncio.to_thread(_get)


async def remove_objects(keys: list[str]) -> None:
    def _remove() -> None:
        c = client()
        for key in keys:
            try:
                c.remove_object(settings.S3_BUCKET, key)
            except Exception as exc:
                print(f"[storage] failed to remove {key}: {exc}")

    await asyncio.to_thread(_remove)


async def list_keys(prefix: str) -> list[str]:
    def _list() -> list[str]:
        return [
            obj.object_name
            for obj in client().list_objects(
                settings.S3_BUCKET, prefix=prefix, recursive=True
            )
        ]

    return await asyncio.to_thread(_list)


IMAGE_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
}


async def read_capped(upload: UploadFile, max_bytes: int) -> bytes:
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
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def parse_image_gps(image_gps: str | None, count: int) -> list[dict[str, float] | None]:
    if not image_gps:
        return [None] * count
    try:
        parsed = json.loads(image_gps)
        assert isinstance(parsed, list)
    except (ValueError, AssertionError):
        raise HTTPException(http_status.HTTP_400_BAD_REQUEST, "invalid image_gps")
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
