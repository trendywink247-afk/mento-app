"""Architecture-hardening proofs (Lane A findings A1–A4, A6).

A1: crisis scans run on a dedicated CapacityLimiter, not the shared threadpool.
A2: the rate-limit window is atomic and self-heals TTL-less ("immortal") keys.
A3: forged X-Forwarded-For can't mint fresh rate-limit identities by default.
A4: the PIN guard fails CLOSED (503) on Redis outage instead of unlimited guesses.
A6: outside dev the API refuses to boot with an empty/shared ADMIN_JWT_SECRET.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace

import pytest
import redis as redis_lib
from fastapi import HTTPException

from app import ratelimit
from app.config import Settings, get_settings


# --- A1: dedicated crisis-scan limiter ---------------------------------------


def test_crisis_scan_uses_dedicated_capacity_limiter():
    import anyio
    from app.routers import stream_hooks

    limiter = stream_hooks._get_crisis_limiter()
    assert isinstance(limiter, anyio.CapacityLimiter)
    assert limiter.total_tokens == get_settings().crisis_scan_threads


def test_crisis_scan_runs_under_the_limiter(monkeypatch):
    """_run_scan must dispatch through the dedicated limiter (not the shared pool)."""
    import asyncio

    from app.routers import stream_hooks

    seen: dict = {}
    original = stream_hooks.anyio.to_thread.run_sync

    async def spy(fn, *args, **kwargs):
        seen["limiter"] = kwargs.get("limiter")
        return await original(fn, *args, **kwargs)

    monkeypatch.setattr(stream_hooks.anyio.to_thread, "run_sync", spy)
    monkeypatch.setattr(
        stream_hooks,
        "_scan_event",
        lambda **kw: SimpleNamespace(triggered=False, signal=None, helplines=[]),
    )
    asyncio.run(
        stream_hooks._run_scan(text="hi", user_id="u", channel_id=None, message_id=None)
    )
    assert seen["limiter"] is stream_hooks._get_crisis_limiter()


# --- A2: atomic window + immortal-key self-repair -----------------------------


def _redis_available() -> bool:
    try:
        ratelimit._redis().ping()
        return True
    except redis_lib.RedisError:
        return False


requires_redis = pytest.mark.skipif(
    not _redis_available(), reason="Redis required for atomic rate-limit proofs"
)


@requires_redis
def test_rate_limit_enforces_and_sets_ttl():
    ratelimit.ENABLED = True
    try:
        key = f"atomic-{uuid.uuid4()}"
        results = [ratelimit.allow(key, 3, 60) for _ in range(5)]
        assert results == [True, True, True, False, False]
        ttl = ratelimit._redis().ttl(f"rl:{key}")
        assert 0 < ttl <= 60  # window key always carries an expiry
    finally:
        ratelimit.ENABLED = False


@requires_redis
def test_rate_limit_heals_immortal_key():
    """A key left without a TTL (the old non-atomic INCR-then-crash bug) must be
    re-stamped with an expiry by the next hit, not throttle forever."""
    ratelimit.ENABLED = True
    try:
        key = f"immortal-{uuid.uuid4()}"
        r = ratelimit._redis()
        r.set(f"rl:{key}", 99)  # simulated immortal key: no TTL
        assert r.ttl(f"rl:{key}") == -1
        assert ratelimit.allow(key, 5, 30) is False  # over budget, still counted
        assert 0 < r.ttl(f"rl:{key}") <= 30  # healed: it now expires
    finally:
        ratelimit.ENABLED = False


# --- A3: X-Forwarded-For trust ------------------------------------------------


def _request_with(xff: str | None, peer: str = "10.0.0.9"):
    headers = {"x-forwarded-for": xff} if xff is not None else {}
    return SimpleNamespace(headers=headers, client=SimpleNamespace(host=peer))


def _patch_hops(monkeypatch, hops: int) -> None:
    monkeypatch.setattr(get_settings(), "trusted_proxy_hops", hops)


def test_forged_xff_ignored_by_default(monkeypatch):
    _patch_hops(monkeypatch, 0)
    req = _request_with("6.6.6.6, 7.7.7.7")
    assert ratelimit.client_ip(req) == "10.0.0.9"  # socket peer, never the header


def test_default_config_has_no_trusted_proxies():
    assert Settings(_env_file=None).trusted_proxy_hops == 0


def test_trusted_hop_takes_rightmost_untrusted(monkeypatch):
    _patch_hops(monkeypatch, 1)
    # client-forged, real-client, our-lb-appended? With 1 trusted hop the right-most
    # entry is what our proxy saw — the real client.
    req = _request_with("6.6.6.6, 203.0.113.5")
    assert ratelimit.client_ip(req) == "203.0.113.5"


def test_trusted_hop_without_header_falls_back_to_peer(monkeypatch):
    _patch_hops(monkeypatch, 1)
    assert ratelimit.client_ip(_request_with(None)) == "10.0.0.9"


# --- A4: PIN guard fails closed on Redis outage --------------------------------


def test_pin_guard_fails_closed_when_redis_down(monkeypatch):
    """With Redis unavailable, fail_closed=True must 503 — never allow unlimited
    PIN guesses (the general limiter fails open; the PIN call site must not)."""
    from app.routers.conversation import _pin_attempt_guard

    class _Boom:
        def pipeline(self):
            raise redis_lib.ConnectionError("redis down")

    monkeypatch.setattr(ratelimit, "_redis", lambda: _Boom())
    ratelimit.ENABLED = True
    try:
        with pytest.raises(HTTPException) as exc:
            _pin_attempt_guard("convo-1", "user-1")
        assert exc.value.status_code == 503
    finally:
        ratelimit.ENABLED = False


def test_non_pin_limits_still_fail_open(monkeypatch):
    class _Boom:
        def pipeline(self):
            raise redis_lib.ConnectionError("redis down")

    monkeypatch.setattr(ratelimit, "_redis", lambda: _Boom())
    ratelimit.ENABLED = True
    try:
        assert ratelimit.allow("open-key", 1, 60) is True
    finally:
        ratelimit.ENABLED = False


# --- A6: ADMIN_JWT_SECRET prod invariant ---------------------------------------


def _boot_problems(**overrides) -> str:
    """Run _enforce_prod_invariants against a synthetic Settings; return the error."""
    from app import main

    base = dict(
        env="prod",
        jwt_secret="a-real-long-random-secret",
        stream_api_key="k",
        stream_api_secret="s",
        cors_origins="https://console.example",
        admin_jwt_secret="a-distinct-admin-secret",
    )
    base.update(overrides)
    settings = Settings(_env_file=None, **base)
    original = main.settings
    main.settings = settings
    try:
        main._enforce_prod_invariants()
        return ""
    except RuntimeError as exc:
        return str(exc)
    finally:
        main.settings = original


def test_prod_boot_ok_with_distinct_admin_secret():
    assert _boot_problems() == ""


def test_prod_refuses_empty_admin_jwt_secret():
    assert "ADMIN_JWT_SECRET" in _boot_problems(admin_jwt_secret="")


def test_prod_refuses_admin_secret_equal_to_jwt_secret():
    assert "ADMIN_JWT_SECRET" in _boot_problems(
        admin_jwt_secret="a-real-long-random-secret"
    )
