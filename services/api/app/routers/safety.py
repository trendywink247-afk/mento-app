"""Crisis scan endpoint (PRD §10). Wired from day one. Support-and-refer, never retain.

NOTE: In the real-time Stream flow, the authoritative scan runs server-to-server in
the Stream *before-message-send* webhook (see routers/stream_hooks.py) — that is the
enforcement point that can't be bypassed by a client. This endpoint remains for
non-Stream callers and tests; it shares the same scan_and_flag code path.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.schemas import ScanRequest, ScanResult
from app.security import current_user_id
from app.services import safety

router = APIRouter(prefix="/safety", tags=["safety"])


@router.post("/scan", response_model=ScanResult)
def scan_message(
    payload: ScanRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ScanResult:
    result = safety.scan_and_flag(
        db, text=payload.text, user_id=user_id, conversation_id=payload.conversation_id
    )
    if result.triggered:
        return ScanResult(
            triggered=True,
            signal=result.signal,
            helplines=result.helplines,
            message=safety.SUPPORT_COPY,
        )
    return ScanResult(triggered=False, signal=result.signal)
