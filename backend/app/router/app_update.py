"""
In-app Android update endpoints for the sideloaded field-officer APK.

The mobile app polls ``/app/android/latest`` (authenticated) to learn the newest
published build, then downloads the signed APK from
``/app/android/download/{version_code}`` (unauthenticated — the download runs
outside the app's bearer-token axios client, and the APK is the app binary
itself, whose integrity is guaranteed by its signing key, not by access control).

Builds are published by ``publish-apk.ps1``, which drops
``firenet-<versionName>-<code>.apk`` and an ``android-latest.json`` metadata file
into ``settings.APP_RELEASE_DIR``.
"""

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import FileResponse

from ..auth.authen import current_active_user
from ..config import get_settings
from ..database.models import User

settings = get_settings()
router = APIRouter()

_MANIFEST_FILE = "android-latest.json"
_APK_MEDIA_TYPE = "application/vnd.android.package-archive"


def _release_dir() -> Path:
    return Path(settings.APP_RELEASE_DIR)


def _find_apk(version_code: int) -> Path | None:
    """Locate the published APK for ``version_code``, or None if absent.

    publish-apk.ps1 names releases ``firenet-<versionName>-<code>.apk`` so the
    file is self-describing on disk and in the officer's Downloads folder. The
    versionName is unknown here, hence the glob. Older releases published under
    the flat ``firenet-<code>.apk`` name are still served, so builds already
    deployed to the server keep working without being renamed.
    """
    d = _release_dir()
    # The trailing "-<code>.apk" anchors the match: code 1 cannot match a file
    # for code 11, and the flat legacy name cannot match here ("*" would have to
    # span the separator).
    matches = sorted(p for p in d.glob(f"firenet-*-{version_code}.apk") if p.is_file())
    if matches:
        return matches[0]
    legacy = d / f"firenet-{version_code}.apk"
    return legacy if legacy.is_file() else None


@router.get("/android/latest")
async def latest_android_build(
    request: Request,
    _user: User = Depends(current_active_user),
):
    """Return metadata for the newest published Android build.

    Reads the manifest written by ``publish-apk.ps1`` and augments it with an
    absolute ``apkUrl`` pointing at the download endpoint. Returns 404 when
    nothing has been published yet — the mobile client treats that (and any
    error) as "up to date", so a missing manifest never blocks the app.
    """
    manifest_path = _release_dir() / _MANIFEST_FILE
    if not manifest_path.is_file():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no published build")
    try:
        # utf-8-sig tolerates a BOM, which Windows PowerShell may prepend when
        # publish-apk.ps1 writes the manifest.
        data = json.loads(manifest_path.read_text("utf-8-sig"))
    except (ValueError, OSError):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "manifest unreadable")
    code = data.get("latestVersionCode")
    if not isinstance(code, int):
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "manifest malformed")
    # PUBLIC_BASE_URL wins because a reverse proxy that strips a path prefix
    # (e.g. /firenet) makes request.base_url point at the wrong path; fall back
    # to the request only when no base is configured.
    base = settings.PUBLIC_BASE_URL.rstrip("/") or str(request.base_url).rstrip("/")
    data["apkUrl"] = f"{base}/app/android/download/{code}"
    return data


@router.get("/android/download/{version_code}")
async def download_android_apk(version_code: int):
    """Stream the signed APK for ``version_code``.

    Unauthenticated by necessity (the client's download task can't attach the
    bearer token) and safe to be — this is the public app binary. ``FileResponse``
    streams from disk and honors HTTP Range, so interrupted downloads resume.
    """
    apk_path = _find_apk(version_code)
    if apk_path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "unknown build")
    # Serve under the on-disk basename so the versionName reaches the browser's
    # Content-Disposition and lands in the officer's Downloads folder.
    return FileResponse(
        apk_path,
        media_type=_APK_MEDIA_TYPE,
        filename=apk_path.name,
    )
