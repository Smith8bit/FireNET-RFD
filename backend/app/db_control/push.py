import asyncio
import os

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database.models import DeviceToken

settings = get_settings()

# Module-level singletons for the Firebase app and messaging client.
# Initialised lazily on first push attempt so missing credentials don't crash startup.
_app = None
_init_attempted = False
_messaging = None


def _ensure_app():
    """Lazily initialise the Firebase Admin SDK, returning the messaging module or None.

    Returns ``None`` (rather than raising) in three safe-skip scenarios:
    - Push is disabled via ``PUSH_ENABLED=false`` in settings.
    - The FCM credentials file is absent or the path is not configured.
    - The ``firebase-admin`` package is not installed in this environment.

    This design lets the server run in environments without push support (e.g. local dev)
    without requiring conditional imports or try/except at every call site.

    Returns:
        The ``firebase_admin.messaging`` module if initialised, else ``None``.
    """
    global _app, _init_attempted, _messaging
    if _init_attempted:
        return _messaging
    _init_attempted = True

    if not settings.PUSH_ENABLED:
        print("[push] disabled (PUSH_ENABLED=false)")
        return None
    cred_path = settings.FCM_CREDENTIALS_FILE
    if not cred_path or not os.path.isfile(cred_path):
        print(
            f"[push] no FCM credentials (FCM_CREDENTIALS_FILE={cred_path!r}); pushes will be logged and skipped"
        )
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
        print(
            f"[push] firebase-admin init failed ({exc}); pushes will be logged and skipped"
        )
        _messaging = None
    return _messaging


async def tokens_for_user(session: AsyncSession, user_id) -> list[str]:
    """Fetch all registered FCM device tokens for ``user_id``.

    Args:
        session: Active async SQLAlchemy session.
        user_id: PK of the target user.

    Returns:
        List of FCM token strings. Empty if the user has no registered devices.
    """
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
    """Send a push notification to all registered devices for ``user_id``.

    Uses FCM Multicast to dispatch to all tokens in a single API call.
    Automatically prunes stale tokens (device uninstalled the app) detected
    in FCM responses to avoid wasting quota on future sends.

    If Firebase is not initialised (missing credentials, package absent, or push
    disabled), the call is a safe no-op that logs the would-be notification.

    Args:
        session: Active async SQLAlchemy session (used for token lookup and stale pruning).
        user_id: PK of the target user.
        title:   Notification title visible in the device notification tray.
        body:    Notification body text.
        data:    Optional key-value payload delivered alongside the notification.
                 All values are coerced to strings because FCM requires string data.

    Returns:
        Number of devices that confirmed successful delivery. Returns ``0`` on
        total failure, no registered devices, or when push is disabled.
    """
    tokens = await tokens_for_user(session, user_id)
    if not tokens:
        return 0
    messaging = _ensure_app()
    # FCM data payloads require all values to be strings.
    data_str = {k: str(v) for k, v in (data or {}).items()}

    if messaging is None:
        print(
            f"[push] (skipped) -> user={user_id} '{title}': {body} data={data_str} devices={len(tokens)}"
        )
        return 0

    def _send_all() -> list:
        # MulticastMessage sends to all tokens in one FCM request, reducing API calls.
        message = messaging.MulticastMessage(
            tokens=tokens,
            notification=messaging.Notification(title=title, body=body),
            data=data_str,
            android=messaging.AndroidConfig(
                priority="high",
                # "appointments" channel must exist on the client; maps to a user-visible
                # notification category with the correct sound/vibration settings.
                notification=messaging.AndroidNotification(channel_id="appointments"),
            ),
        )
        return messaging.send_each_for_multicast(message).responses

    try:
        # FCM SDK is synchronous; run in a thread to avoid blocking the event loop.
        responses = await asyncio.to_thread(_send_all)
    except Exception as exc:
        print(f"[push] send failed for user={user_id}: {exc}")
        return 0
    stale: list[str] = []
    delivered = 0
    for token, resp in zip(tokens, responses):
        if resp.success:
            delivered += 1
        elif resp.exception is not None and "registration-token-not-registered" in str(
            resp.exception
        ).lower().replace("_", "-"):
            # Token is invalid — the user uninstalled the app. Remove it immediately
            # to prevent accumulating dead tokens that consume FCM quota.
            stale.append(token)
    if stale:
        await session.execute(delete(DeviceToken).where(DeviceToken.token.in_(stale)))
        print(f"[push] pruned {len(stale)} stale token(s) for user={user_id}")
    print(f"[push] delivered to {delivered}/{len(tokens)} device(s) for user={user_id}")
    return delivered
