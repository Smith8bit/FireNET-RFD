"""S3/MinIO access for fire-resolution evidence. The minio client is sync, so
every call is pushed to a thread to keep the event loop free."""

import asyncio
from io import BytesIO

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
            for obj in client().list_objects(settings.S3_BUCKET, prefix=prefix, recursive=True)
        ]

    return await asyncio.to_thread(_list)
