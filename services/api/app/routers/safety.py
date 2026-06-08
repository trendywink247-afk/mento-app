"""Crisis scan endpoint (PRD §10). Wired from day one. Support-and-refer, never retain."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.safety import SafetyFlag
from app.schemas import ScanRequest, ScanResult
from app.security import current_user_id
from app.services import crisis

router = APIRouter(prefix="/safety", tags=["safety"])

_SUPPORT_COPY = (
    "It sounds like you're going through something really heavy right now, and you "
    "don't have to face it alone. The people below are trained to help, any time of day."
)


@router.post("/scan", response_model=ScanResult)
def scan_message(
    payload: ScanRequest,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ScanResult:
    result = crisis.scan(payload.text)

    if result.triggered:
        # Persist the SIGNAL and matched terms, never the message body.
        db.add(
            SafetyFlag(
                conversation_id=payload.conversation_id,
                user_id=user_id,
                signal=result.signal,
                matched_terms=result.matched_str,
            )
        )
        db.commit()
        return ScanResult(
            triggered=True,
            signal=result.signal,
            helplines=result.helplines,
            message=_SUPPORT_COPY,
        )

    return ScanResult(triggered=False, signal=result.signal)
