"""Firebase Cloud Messaging delivery.

Direct FCM via the firebase-admin SDK. The whole path degrades gracefully
when unconfigured: with no service-account file (or firebase-admin not
installed) `send_push` logs the intended message and returns, so token
registration, appointment, and the rest of the app work end-to-end before
credentials exist. To go live, set FCM_CREDENTIALS_FILE to a service-account
JSON and `pip install firebase-admin`.
"""
import asyncio
import os

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database.models import DeviceToken

settings = get_settings()

_app = None          # cached firebase_admin app
_init_attempted = False
_messaging = None


def _ensure_app():
    """Lazily initialize the firebase-admin app. Returns the messaging module
    when ready, or None when push is disabled / unconfigured / unavailable."""
    global _app, _init_attempted, _messaging
    if _init_attempted:
        return _messaging
    _init_attempted = True

    if not settings.PUSH_ENABLED:
        print("[push] disabled (PUSH_ENABLED=false)")
        return None
    cred_path = settings.FCM_CREDENTIALS_FILE
    if not cred_path or not os.path.isfile(cred_path):
        print(f"[push] no FCM credentials (FCM_CREDENTIALS_FILE={cred_path!r}); pushes will be logged and skipped")
        return None
    try:
        import firebase_admin
        from firebase_admin import credentials, messaging
    except ImportError:
        print("[push] firebase-admin not installed; pushes will be logged and skipped")
        return None
    try:
        _app = firebase_admin.initialize_app(credentials.Certificate(cred_path))
        _messaging = messaging
        print("[push] firebase-admin initialized")
    except Exception as exc:
        print(f"[push] firebase-admin init failed ({exc}); pushes will be logged and skipped")
        _messaging = None
    return _messaging


async def tokens_for_user(session: AsyncSession, user_id) -> list[str]:
    rows = await session.execute(
        select(DeviceToken.token).where(DeviceToken.user_id == user_id)
    )
    return [r[0] for r in rows.all()]


async def send_push(
    session: AsyncSession,
    user_id,
    *,
    title: str,
    body: str,
    data: dict | None = None,
) -> int:
    """Send a notification to all of a user's registered devices.

    Returns the number of devices the message was delivered to (0 when
    unconfigured). Tokens FCM reports as unregistered are pruned. Never raises
    — push is best-effort and must not fail the surrounding transaction."""
    tokens = await tokens_for_user(session, user_id)
    if not tokens:
        return 0

    messaging = _ensure_app()
    # string values only: FCM data payloads must be string→string
    data_str = {k: str(v) for k, v in (data or {}).items()}

    if messaging is None:
        print(f"[push] (skipped) -> user={user_id} '{title}': {body} data={data_str} devices={len(tokens)}")
        return 0

    def _send_all() -> list:
        message = messaging.MulticastMessage(
            tokens=tokens,
            notification=messaging.Notification(title=title, body=body),
            data=data_str,
            # channel_id must match ANDROID_CHANNEL_ID in mobile/src/lib/push.ts so
            # background notifications use the same HIGH-importance heads-up channel
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(channel_id="appointments"),
            ),
        )
        return messaging.send_each_for_multicast(message).responses

    try:
        responses = await asyncio.to_thread(_send_all)
    except Exception as exc:
        print(f"[push] send failed for user={user_id}: {exc}")
        return 0

    stale: list[str] = []
    delivered = 0
    for token, resp in zip(tokens, responses):
        if resp.success:
            delivered += 1
        elif resp.exception is not None and "registration-token-not-registered" in str(resp.exception).lower().replace("_", "-"):
            stale.append(token)
    if stale:
        await session.execute(delete(DeviceToken).where(DeviceToken.token.in_(stale)))
        # caller's transaction commits this; if there's no outer commit it's harmless
        print(f"[push] pruned {len(stale)} stale token(s) for user={user_id}")
    print(f"[push] delivered to {delivered}/{len(tokens)} device(s) for user={user_id}")
    return delivered
