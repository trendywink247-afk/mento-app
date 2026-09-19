"""Crisis scan endpoint (PRD §10). Wired from day one. Support-and-refer, never retain.

NOTE: In the real-time Stream flow, the authoritative scan runs server-to-server in
the Stream *before-message-send* webhook (see routers/stream_hooks.py) — that is the
enforcement point that can't be bypassed by a client. This endpoint remains for
non-Stream callers and tests; it shares the same scan_and_flag code path.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import ratelimit
from app.db import get_db
from app.models.conversation import Conversation
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
    # The authoritative scan is the Stream webhook (deduped by message id). This one
    # has no dedupe key, so an unthrottled caller could bury the human-review queue
    # under thousands of flags. The 429 carries no helplines — the client only calls
    # this beside the real message path, which still scans.
    ratelimit.enforce(
        f"safety-scan:{user_id}", 30, 600, detail="Too many requests — please wait a moment."
    )
    # A caller may only tag their OWN conversation — otherwise crisis flags could
    # be planted against arbitrary conversations, poisoning the review queue.
    if payload.conversation_id is not None:
        convo = db.get(Conversation, payload.conversation_id)
        if convo is None or convo.user_id != user_id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
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
