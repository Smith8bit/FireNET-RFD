import time
from collections import defaultdict, deque
from threading import Lock

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

# Only sweep the hit-tracking dict for fully-stale keys every N ops, rather than on every
# request, to amortize the O(n) dict scan cost instead of paying it on every single check().
_LOG_EVERY_N_OPS = 1000

# Only POSTs to these auth/registration-adjacent endpoints are throttled: they're the routes
# most attractive for credential-stuffing / brute-force / spam-registration abuse, so the
# limiter is scoped narrowly rather than applied globally to avoid throttling normal traffic.
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
    """Per-key sliding-window rate limiter backed by an in-process dict of deques.

    Not distributed: state is local to a single process, so this only bounds abuse per
    app instance, not per-cluster. Acceptable here since it's a defense-in-depth layer
    guarding a handful of sensitive auth endpoints, not the sole line of defense.

    Args:
        limit: Maximum number of hits allowed for a key within `window_seconds`.
        window_seconds: Length of the sliding window, in seconds.
    """

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()
        self._ops = 0

    def check(self, key: str, now: float | None = None) -> tuple[bool, int]:
        """Record a hit for `key` and report whether it's within the rate limit.

        Args:
            key: Identity being throttled (e.g. "<client_ip>|<path>").
            now: Injectable clock value for deterministic unit testing; defaults to
                time.monotonic() (monotonic, not wall-clock, so it's immune to system
                clock adjustments/NTP jumps skewing the window).
        Returns:
            (allowed, retry_after_seconds): `allowed` is False once `limit` hits have
            landed inside the window; `retry_after_seconds` is 0 when allowed, otherwise
            the number of seconds until the oldest hit ages out (minimum 1, so callers
            never send a Retry-After of 0).
        """
        now = time.monotonic() if now is None else now
        cutoff = now - self.window
        with self._lock:
            dq = self._hits[key]
            # Evict hits that have aged out of the window from the front of the deque;
            # entries are appended in increasing time order so this is a cheap prefix trim.
            while dq and dq[0] <= cutoff:
                dq.popleft()
            if len(dq) >= self.limit:
                retry_after = int(dq[0] + self.window - now) + 1
                return False, max(retry_after, 1)
            dq.append(now)
            self._maybe_sweep(cutoff)
            return True, 0

    def _maybe_sweep(self, cutoff: float) -> None:
        """Periodically purge keys with no recent hits to prevent unbounded dict growth.

        Without this, `_hits` would retain one deque per distinct key (e.g. per client IP)
        forever, since `check()` alone never removes empty entries from the outer dict.
        """
        self._ops += 1
        if self._ops % _LOG_EVERY_N_OPS:
            return
        stale = [k for k, dq in self._hits.items() if not dq or dq[-1] <= cutoff]
        for k in stale:
            del self._hits[k]


def client_key(request: Request) -> str:
    """Derive a best-effort client identity for rate-limiting purposes.

    Args:
        request: The incoming FastAPI/Starlette request.
    Returns:
        The first hop in X-Forwarded-For if present (assumes a trusted reverse proxy sets
        this header; the leftmost value is the original client), otherwise the direct
        socket peer address, or "unknown" if neither is available.
    """
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def install_rate_limiting(
    app: FastAPI, *, limit: int = 10, window_seconds: float = 60.0
) -> None:
    """Attach the sliding-window rate limiter to `app` as HTTP middleware.

    Args:
        app: The FastAPI application to instrument.
        limit: Max requests per key per window (keyword-only, from Settings.RATE_LIMIT_MAX).
        window_seconds: Sliding window length in seconds (from Settings.RATE_LIMIT_WINDOW_SECONDS).
    Returns:
        None; registers the middleware as a side effect.
    """
    limiter = SlidingWindowRateLimiter(limit=limit, window_seconds=window_seconds)

    @app.middleware("http")
    async def _rate_limit(request: Request, call_next):
        # Key is IP+path combined so the limit is per-endpoint-per-client: hitting one
        # sensitive route repeatedly doesn't consume budget on a different one.
        if request.method == "POST" and request.url.path in SENSITIVE_PATHS:
            allowed, retry_after = limiter.check(
                f"{client_key(request)}|{request.url.path}"
            )
            if not allowed:
                # Thai-language error message: user-facing text for this deployment's locale.
                return JSONResponse(
                    {"detail": "โปรดรอสักครู่แล้วลองใหม่อีกครั้ง"},
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    headers={"Retry-After": str(retry_after)},
                )
        return await call_next(request)
