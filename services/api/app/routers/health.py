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
/status/public    — public, unauthenticated, always 200. The one endpoint the
    public status page (status.mento.chat) is allowed to read. Aggregate
    counts only — see its docstring for exactly what that excludes.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

import redis
from fastapi import APIRouter, Response, status
from sqlalchemy import func, select, text

from app.db import SessionLocal
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
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


def _crisis_status() -> dict:
    """Pure computation behind /health/crisis, reused by /status/public so the
    public page reports the same signal without duplicating the staleness logic."""
    if not stream.is_configured():
        return {"status": "ok", "note": "stream not configured (stub mode) — no webhooks expected"}

    last_raw: str | None = None
    try:
        from app import ratelimit

        last_raw = ratelimit._redis().get("mento:last_webhook_at")
    except redis.RedisError as exc:
        logger.warning("crisis-health: redis unreachable (%s)", exc)
        return {"status": "unknown", "detail": "redis unreachable — webhook liveness unknowable"}

    if last_raw is None:
        return {
            "status": "stale",
            "detail": "no Stream webhook ever recorded",
            "last_webhook_at": None,
        }

    try:
        last = datetime.fromisoformat(last_raw)
    except (ValueError, TypeError) as exc:
        logger.warning("crisis-health: malformed webhook stamp %r (%s)", last_raw, exc)
        return {
            "status": "degraded",
            "detail": "malformed webhook liveness stamp — treating as unknown",
            "last_webhook_at": last_raw,
        }
    if last.tzinfo is None:
        last = last.replace(tzinfo=UTC)
    age = datetime.now(UTC) - last
    if age > STALE_AFTER:
        return {
            "status": "stale",
            "detail": f"last Stream webhook {int(age.total_seconds() // 60)} min ago",
            "last_webhook_at": last_raw,
        }
    return {"status": "ok", "last_webhook_at": last_raw}


@router.get("/health/crisis")
def crisis_webhook_health(response: Response) -> dict:
    """503 when the crisis-scan webhook looks dead; 200 otherwise.

    "Dead" = Stream is configured (so webhooks SHOULD be arriving) but none has
    been stamped within STALE_AFTER. In stub mode (no Stream creds — dev) this
    reports ok with a note, so dev environments don't page anyone.
    """
    result = _crisis_status()
    if result["status"] != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result


@router.get("/status/public")
def public_status(response: Response) -> dict:
    """Everything the public status page (status.mento.chat) is allowed to show.

    Deliberately narrow: aggregate counts only, never anything crisis-specific
    beyond a healthy/stale word (never a flag count — T&S: crisis data never
    feeds a dashboard, public or otherwise) and never anything identity-linked.
    Always 200 — the page reads the fields, it doesn't read the HTTP status.

    Open CORS on purpose: this is the one route the public status page (a
    different origin, status.mento.chat) fetches directly from the browser.
    No cookies/auth involved, so a wildcard here doesn't touch the app's real
    CORS_ORIGINS allowlist (CORSMiddleware, main.py) at all.
    """
    response.headers["Access-Control-Allow-Origin"] = "*"
    db_ok = _db_ok()
    crisis = _crisis_status()

    def count(stmt) -> int:
        try:
            with SessionLocal() as db:
                return db.execute(stmt).scalar_one()
        except Exception as exc:  # noqa: BLE001 — a public probe reports, it never raises
            logger.warning("status/public: count query failed (%s)", type(exc).__name__)
            return -1

    return {
        "api": "healthy",
        "database": "healthy" if db_ok else "unhealthy",
        "crisis_safety_net": "healthy" if crisis["status"] == "ok" else "stale",
        "members_total": count(select(func.count()).select_from(User)),
        "mentors_online": count(
            select(func.count())
            .select_from(ListenerProfile)
            .where(
                ListenerProfile.status == ListenerStatus.online,
                ListenerProfile.vetting_status == VettingStatus.approved,
            )
        ),
        "conversations_active": count(
            select(func.count())
            .select_from(Conversation)
            .where(Conversation.status == ConversationStatus.active)
        ),
    }
