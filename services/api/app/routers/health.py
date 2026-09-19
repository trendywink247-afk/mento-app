"""Liveness, readiness + the crisis-webhook staleness probe.

/health           — plain liveness (the process answers). Never touches a dependency.
/health/ready     — readiness: 503 when Postgres is unreachable (nothing works without
    it). Redis and Stream are REPORTED but never fail the probe — the limiter fails
    open and a Stream outage must not take the whole API out of rotation.
/health/crisis    — ACTIVE alerting hook for the fail-open crisis scan (T&S #1).
    The scan fails open by design, so a dead webhook is silent by default. The
    admin Health tab shows staleness, but only when someone looks. This endpoint
    returns 503 when no Stream webhook has been seen recently, so any dumb
    uptime monitor (UptimeRobot, Pingdom, a cron + curl) pinging it becomes a
    pager for the flagship safety guarantee. Wire a monitor to this URL before
    launch (PRELAUNCH_CHECKLIST).
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import redis
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.db import SessionLocal
from app.services import stream

logger = logging.getLogger("mento.health")
router = APIRouter(tags=["meta"])

# How long without any Stream webhook before we consider the scan pipeline dead.
# Generous: quiet hours happen, but a busy support app should never be silent
# this long. Tune down once real traffic gives a baseline.
STALE_AFTER = timedelta(minutes=30)


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


def _db_ok() -> bool:
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        return True
    except Exception as exc:  # noqa: BLE001 — a probe reports, it never raises
        logger.warning("readiness: database unreachable (%s)", type(exc).__name__)
        return False


def _redis_ok() -> bool:
    try:
        from app import ratelimit

        return bool(ratelimit._redis().ping())
    except Exception as exc:  # noqa: BLE001
        logger.warning("readiness: redis unreachable (%s)", type(exc).__name__)
        return False


@router.get("/health/ready")
def ready(response: Response) -> dict:
    db_ok = _db_ok()
    if not db_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {
        "status": "ok" if db_ok else "unavailable",
        "db": db_ok,
        "redis": _redis_ok(),  # degraded, not fatal: rate limits fail open
        "stream_configured": stream.is_configured(),
    }


@router.get("/health/crisis")
def crisis_webhook_health(response: Response) -> dict:
    """503 when the crisis-scan webhook looks dead; 200 otherwise.

    "Dead" = Stream is configured (so webhooks SHOULD be arriving) but none has
    been stamped within STALE_AFTER. In stub mode (no Stream creds — dev) this
    reports ok with a note, so dev environments don't page anyone.
    """
    if not stream.is_configured():
        return {"status": "ok", "note": "stream not configured (stub mode) — no webhooks expected"}

    last_raw: str | None = None
    try:
        from app import ratelimit

        last_raw = ratelimit._redis().get("mento:last_webhook_at")
    except redis.RedisError as exc:
        # Redis down: we can't prove the webhook is alive. Surface it — the
        # monitor should page, because the silent-death detector itself is blind.
        logger.warning("crisis-health: redis unreachable (%s)", exc)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unknown", "detail": "redis unreachable — webhook liveness unknowable"}

    if last_raw is None:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "stale",
            "detail": "no Stream webhook ever recorded",
            "last_webhook_at": None,
        }

    try:
        last = datetime.fromisoformat(last_raw)
    except (ValueError, TypeError) as exc:
        # A corrupted stamp must degrade the probe, never 500 it — the monitor
        # should still see a definitive "something is wrong" signal.
        logger.warning("crisis-health: malformed webhook stamp %r (%s)", last_raw, exc)
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "degraded",
            "detail": "malformed webhook liveness stamp — treating as unknown",
            "last_webhook_at": last_raw,
        }
    if last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    age = datetime.now(UTC) - last
    if age > STALE_AFTER:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "stale",
            "detail": f"last Stream webhook {int(age.total_seconds() // 60)} min ago",
            "last_webhook_at": last_raw,
        }
    return {"status": "ok", "last_webhook_at": last_raw}
