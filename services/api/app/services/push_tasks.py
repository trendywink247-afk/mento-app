"""BackgroundTask entry points for request-path pushes: own DB session, catch-all."""

from __future__ import annotations

import logging

from app.db import SessionLocal
from app.services import push

logger = logging.getLogger("mento.push")


def notify_request_created_safe(request_id: str) -> None:
    try:
        with SessionLocal() as db:
            push.notify_request_created(db, request_id=request_id)
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("push (request created) failed: %s", type(exc).__name__)


def notify_request_accepted_safe(request_id: str) -> None:
    try:
        with SessionLocal() as db:
            push.notify_request_accepted(db, request_id=request_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("push (request accepted) failed: %s", type(exc).__name__)
