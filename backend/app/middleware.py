import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

_LOG_EVERY_N_OPS = 1000

SENSITIVE_PATHS = frozenset(
    {
        "/auth/cookie/login",
        "/auth/jwt/login",
        "/auth/register",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/officers/register",
    }
)


class SlidingWindowRateLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._ops = 0

    def check(self, key: str, now: float | None = None) -> tuple[bool, int]:
        now = time.monotonic() if now is None else now
        cutoff = now - self.window
        with self._lock:
            dq = self._hits[key]
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= self.limit:
                retry_after = int(dq[0] + self.window - now) + 1
                return False, max(retry_after, 1)
            dq.append(now)
            self._maybe_sweep(cutoff)
            return True, 0

    def _maybe_sweep(self, cutoff: float) -> None:
        self._ops += 1
        if self._ops % _LOG_EVERY_N_OPS:
            return
        stale = [k for k, dq in self._hits.items() if not dq or dq[-1] <= cutoff]
        for k in stale:
            del self._hits[k]


def client_key(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def install_rate_limiting(
    app: FastAPI, *, limit: int = 10, window_seconds: float = 60.0
) -> None:
    limiter = SlidingWindowRateLimiter(limit=limit, window_seconds=window_seconds)

    @app.middleware("http")
    async def _rate_limit(request: Request, call_next):
        if request.method == "POST" and request.url.path in SENSITIVE_PATHS:
            allowed, retry_after = limiter.check(
                f"{client_key(request)}|{request.url.path}"
            )
            if not allowed:
                return JSONResponse(
                    {"detail": "โปรดรอสักครู่แล้วลองใหม่อีกครั้ง"},
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    headers={"Retry-After": str(retry_after)},
                )
        return await call_next(request)
