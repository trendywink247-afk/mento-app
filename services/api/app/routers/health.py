"""Liveness + the crisis-webhook staleness probe.

/health           — plain liveness for load balancers.
/health/crisis    — ACTIVE alerting hook for the fail-open crisis scan (T&S #1).
    The scan fails open by design, so a dead webhook is silent by default. The
    admin Health tab shows staleness, but only when someone looks. This endpoint
    returns 503 when no Stream webhook has been seen recently, so any dumb
    uptime monitor (UptimeRobot, Pingdom, a cron + curl) pinging it becomes a
    pager for the flagship safety guarantee. Wire a monitor to this URL before
    launch (PRELAUNCH_CHECKLIST).
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Response, status

from app.services import stream

router = APIRouter(tags=["meta"])

# How long without any Stream webhook before we consider the scan pipeline dead.
# Generous: quiet hours happen, but a busy support app should never be silent
# this long. Tune down once real traffic gives a baseline.
STALE_AFTER = timedelta(minutes=30)


@router.get("/health")
def health() -> dict:
    return {"status": "ok"}


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
    except Exception:
        # Redis down: we can't prove the webhook is alive. Surface it — the
        # monitor should page, because the silent-death detector itself is blind.
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "unknown", "detail": "redis unreachable — webhook liveness unknowable"}

    if last_raw is None:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "stale", "detail": "no Stream webhook ever recorded", "last_webhook_at": None}

    last = datetime.fromisoformat(last_raw)
    age = datetime.now(timezone.utc) - last
    if age > STALE_AFTER:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {
            "status": "stale",
            "detail": f"last Stream webhook {int(age.total_seconds() // 60)} min ago",
            "last_webhook_at": last_raw,
        }
    return {"status": "ok", "last_webhook_at": last_raw}
