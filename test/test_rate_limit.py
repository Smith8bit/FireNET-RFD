"""Unit tests for the auth rate limiter (app.middleware)."""
from app.middleware import SlidingWindowRateLimiter, SENSITIVE_PATHS


def test_allows_up_to_limit_then_blocks():
    rl = SlidingWindowRateLimiter(limit=3, window_seconds=60)
    now = 1000.0
    assert rl.check("ip", now)[0] is True
    assert rl.check("ip", now)[0] is True
    assert rl.check("ip", now)[0] is True
    allowed, retry_after = rl.check("ip", now)
    assert allowed is False
    assert retry_after >= 1  # Retry-After is a positive whole number of seconds


def test_window_slides_and_frees_up():
    rl = SlidingWindowRateLimiter(limit=1, window_seconds=10)
    assert rl.check("ip", 100.0)[0] is True
    assert rl.check("ip", 105.0)[0] is False  # still inside the 10s window
    assert rl.check("ip", 111.0)[0] is True   # first hit aged out


def test_keys_are_isolated():
    rl = SlidingWindowRateLimiter(limit=1, window_seconds=60)
    assert rl.check("a", 0.0)[0] is True
    assert rl.check("a", 0.0)[0] is False
    assert rl.check("b", 0.0)[0] is True  # a different client is unaffected


def test_sensitive_paths_cover_login_and_registration():
    assert "/auth/cookie/login" in SENSITIVE_PATHS
    assert "/auth/register" in SENSITIVE_PATHS
    assert "/officers/register" in SENSITIVE_PATHS
