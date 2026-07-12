"""Redis-backed rate limiting (the "Redis rate limits" the stack table promises).

Fixed-window INCR+EXPIRE — coarse but honest, and enough to stop the two real
abuse patterns on an anonymous app: flooding the unauthenticated endpoints
(onboarding creates a real user + Stream upsert per call; match consumes human
listener capacity) and online-guessing the 4-digit conversation PIN.

Fail-mode: OPEN with a warning when Redis is unreachable. This is a support app —
an infra hiccup must degrade to "no throttle", never to "nobody can talk"
(the same philosophy as the crisis-webhook fail-open, Trust & Safety #1).
"""
from __future__ import annotations

import logging
from functools import lru_cache

import redis
from fastapi import HTTPException, Request, status

from app.config import get_settings

logger = logging.getLogger("mento.ratelimit")

# Test hook: conftest flips this off so unrelated suites never trip a window;
# the rate-limit tests flip it back on around unique keys.
ENABLED: bool | None = None  # None = defer to settings.rate_limit_enabled


@lru_cache
def _redis() -> redis.Redis:
    return redis.Redis.from_url(
        get_settings().redis_url,
        socket_connect_timeout=0.5,
        socket_timeout=0.5,
        decode_responses=True,
    )


def _is_enabled() -> bool:
    if ENABLED is not None:
        return ENABLED
    return get_settings().rate_limit_enabled


def allow(key: str, limit: int, window_seconds: int) -> bool:
    """True if this hit is within the window's budget. Fail-open on Redis errors."""
    if not _is_enabled():
        return True
    try:
        r = _redis()
        full_key = f"rl:{key}"
        count = r.incr(full_key)
        if count == 1:
            r.expire(full_key, window_seconds)
        return int(count) <= limit
    except redis.RedisError as exc:  # fail open, never silent
        logger.warning("rate limiter unavailable (%s) — allowing request", exc)
        return True


def enforce(key: str, limit: int, window_seconds: int, *, detail: str) -> None:
    """Raise 429 when the window's budget is exhausted."""
    if not allow(key, limit, window_seconds):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail)


def client_ip(request: Request) -> str:
    """Best-effort caller identity for unauthenticated endpoints. Behind a proxy
    the first X-Forwarded-For hop is the client; direct connections use the peer."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def by_ip(name: str, limit: int, window_seconds: int, *, detail: str):
    """Dependency factory: per-IP fixed-window limit for anonymous endpoints."""

    def dependency(request: Request) -> None:
        enforce(f"{name}:{client_ip(request)}", limit, window_seconds, detail=detail)

    return dependency
