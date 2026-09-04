"""Redis-backed rate limiting (the "Redis rate limits" the stack table promises).

Fixed-window counting — coarse but honest, and enough to stop the two real
abuse patterns on an anonymous app: flooding the unauthenticated endpoints
(onboarding creates a real user + Stream upsert per call; match consumes human
listener capacity) and online-guessing the 4-digit conversation PIN.

Atomicity: the window is INCR + EXPIRE(NX) in one pipeline. EXPIRE with the NX
flag sets the TTL only when the key has none, which both starts a fresh window
atomically with its first hit AND self-heals any "immortal" key left behind by
a historical non-atomic INCR-then-crash (a key without a TTL would otherwise
throttle forever).

Fail-mode: OPEN with a warning when Redis is unreachable (never silent). This
is a support app — an infra hiccup must degrade to "no throttle", never to
"nobody can talk" (same philosophy as the crisis-webhook fail-open, T&S #1).
Exception: call sites guarding secrets (the conversation PIN) pass
``fail_closed=True`` and get a 503 instead — see routers/conversation.py.
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


def allow(key: str, limit: int, window_seconds: int, *, fail_closed: bool = False) -> bool:
    """True if this hit is within the window's budget.

    Redis errors: fail OPEN by default (logged, never silent); with
    ``fail_closed=True`` they raise 503 instead — for guards where "unlimited
    attempts" is worse than "try again later" (PIN brute-force).
    """
    if not _is_enabled():
        return True
    try:
        r = _redis()
        full_key = f"rl:{key}"
        # One pipeline: INCR starts/advances the window; EXPIRE(NX) stamps the
        # TTL only when absent — atomic window start + immortal-key self-repair.
        pipe = r.pipeline()
        pipe.incr(full_key)
        pipe.expire(full_key, window_seconds, nx=True)
        count, _ = pipe.execute()
        return int(count) <= limit
    except redis.RedisError as exc:
        if fail_closed:
            logger.warning("rate limiter unavailable (%s) — failing CLOSED", exc)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "Temporarily unavailable — please try again shortly.",
            ) from exc
        logger.warning("rate limiter unavailable (%s) — allowing request", exc)
        return True


def enforce(
    key: str, limit: int, window_seconds: int, *, detail: str, fail_closed: bool = False
) -> None:
    """Raise 429 when the window's budget is exhausted (503 on Redis outage if
    ``fail_closed=True``)."""
    if not allow(key, limit, window_seconds, fail_closed=fail_closed):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail)


def client_ip(request: Request) -> str:
    """Caller identity for unauthenticated rate limits.

    X-Forwarded-For is attacker-writable: any client can send the header, and
    every proxy appends the peer it saw to the RIGHT. So the only trustworthy
    hops are the right-most ``trusted_proxy_hops`` entries (appended by our own
    infra). With no trusted proxy configured (the default) we ignore XFF
    entirely and use the socket peer — a forged header must never mint fresh
    rate-limit identities.
    """
    hops = get_settings().trusted_proxy_hops
    peer = request.client.host if request.client else "unknown"
    if hops <= 0:
        return peer
    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer
    parts = [p.strip() for p in forwarded.split(",") if p.strip()]
    if not parts:
        return peer
    # The right-most untrusted hop: the address our nearest trusted proxy saw.
    index = max(len(parts) - hops, 0)
    return parts[index]


def by_ip(name: str, limit: int, window_seconds: int, *, detail: str):
    """Dependency factory: per-IP fixed-window limit for anonymous endpoints."""

    def dependency(request: Request) -> None:
        enforce(f"{name}:{client_ip(request)}", limit, window_seconds, detail=detail)

    return dependency
