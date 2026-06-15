"""Lightweight, dependency-free rate limiting for the sensitive auth endpoints.

This throttles credential brute force and registration/enumeration abuse at the
application edge. It is an in-process sliding window, so each worker enforces its
own limit — keep it as defence in depth and ALSO rate-limit at the gateway/proxy
(and move to a shared store, e.g. Redis, if you need a global cap across workers;
see the realtime scale-out note in the audit).
"""

import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

# POST endpoints where a flood is almost always abuse. Tuned generously so a real
# user fumbling a password is never blocked, while a scripted attack is.
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
    """Per-key sliding window. Thread-safe; bounded memory via lazy pruning."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._ops = 0

    def check(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """Record a hit for `key`. Returns (allowed, retry_after_seconds)."""
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
        # drop keys idle past the window so distinct attacker IPs can't grow the
        # map without bound; runs occasionally, under the lock
        self._ops += 1
        if self._ops % 1000:
            return
        stale = [k for k, dq in self._hits.items() if not dq or dq[-1] <= cutoff]
        for k in stale:
            del self._hits[k]


def client_key(request: Request) -> str:
    """Best-effort client identity. Prefers the left-most X-Forwarded-For entry
    (the real client when behind a trusted proxy) and falls back to the socket
    peer. Note: XFF is client-controllable unless a trusted proxy overwrites it —
    this is defence in depth, not a hard control."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def install_rate_limiting(app: FastAPI, *, limit: int = 10, window_seconds: float = 60.0) -> None:
    limiter = SlidingWindowRateLimiter(limit=limit, window_seconds=window_seconds)

    @app.middleware("http")
    async def _rate_limit(request: Request, call_next):
        if request.method == "POST" and request.url.path in SENSITIVE_PATHS:
            allowed, retry_after = limiter.check(f"{client_key(request)}|{request.url.path}")
            if not allowed:
                return JSONResponse(
                    {"detail": "Too many attempts. Please wait and try again."},
                    status_code=429,
                    headers={"Retry-After": str(retry_after)},
                )
        return await call_next(request)
