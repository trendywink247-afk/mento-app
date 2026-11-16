"""Answer evaluations (DECISIONS T.8): members send photos of an answer, mentors return feedback.
Every route answers 404 while `evaluations_enabled` is off, so the app reads that as "coming soon"."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.models.answer_evaluation import AnswerEvaluation, AnswerPage
from app.models.listener import ListenerProfile
from app.routers.listener_console import current_listener
from app.schemas.evaluations import (
    EvaluationOut,
    EvaluationStartIn,
    FeedbackIn,
    MentorEvaluationOut,
    PageAdded,
    PageIn,
)
from app.schemas.listeners import SupportOut
from app.security import current_user_id
from app.services import evaluations, safety


def switched_on() -> None:
    if not get_settings().evaluations_enabled:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not Found")


member_router = APIRouter(
    prefix="/evaluations", tags=["evaluations"], dependencies=[Depends(switched_on)]
)
mentor_router = APIRouter(
    prefix="/listener/me/evaluations", tags=["evaluations"], dependencies=[Depends(switched_on)]
)


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


def _name(db: Session, listener_id: str | None) -> str | None:
    li = db.get(ListenerProfile, listener_id) if listener_id else None
    return li.persona_name if li else None


def _member_out(db: Session, ev: AnswerEvaluation) -> EvaluationOut:
    return EvaluationOut(
        id=ev.id,
        kind=ev.kind,
        audience=ev.audience,
        status=ev.status,
        question=ev.question,
        note=ev.note,
        pages=evaluations.page_count(db, ev.id),
        pages_available=ev.pages_wiped_at is None,
        sent_at=_iso(ev.sent_at),
        returned_at=_iso(ev.returned_at),
        feedback=ev.feedback if ev.status == "returned" else None,
        mentor_name=_name(db, ev.listener_id or ev.target_listener_id),
    )


def _mentor_out(db: Session, ev: AnswerEvaluation) -> MentorEvaluationOut:
    now = datetime.now(UTC)
    due = ev.claimed_at + timedelta(hours=evaluations.CLAIM_HOURS) if ev.claimed_at else None
    paid = ev.payout_paise if ev.status == "returned" else None
    return MentorEvaluationOut(
        id=ev.id,
        kind=ev.kind,
        personal=ev.audience == "one",
        status=ev.status,
        question=ev.question,
        note=ev.note,
        pages=evaluations.page_count(db, ev.id),
        pages_available=ev.pages_wiped_at is None,
        sent_at=_iso(ev.sent_at),
        due_at=_iso(due) if ev.status == "claimed" else None,
        feedback=ev.feedback if ev.status == "returned" else None,
        payout_paise=(
            paid if paid is not None else evaluations.payout_for(ev.kind, ev.sent_at or now, now)
        ),
    )


def _page(db: Session, ev: AnswerEvaluation, idx: int) -> Response:
    page = db.scalar(
        select(AnswerPage).where(AnswerPage.evaluation_id == ev.id, AnswerPage.idx == idx)
    )
    if page is None or page.content is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no photo")
    return Response(
        content=page.content,
        media_type=page.content_type,
        headers={"Cache-Control": "no-store", "Content-Disposition": "inline"},
    )


# ---- member ----------------------------------------------------------------------------------


@member_router.get("", response_model=list[EvaluationOut])
def my_evaluations(
    user_id: str = Depends(current_user_id), db: Session = Depends(get_db)
) -> list[EvaluationOut]:
    return [_member_out(db, ev) for ev in evaluations.mine(db, user_id)]


@member_router.post("", response_model=EvaluationOut, status_code=status.HTTP_201_CREATED)
def start_evaluation(
    payload: EvaluationStartIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> EvaluationOut:
    ratelimit.enforce(
        f"evaluations:{user_id}", 10, 86400, detail="That is a lot for one day. Try tomorrow."
    )
    ev = evaluations.start(
        db,
        user_id,
        kind=payload.kind,
        audience=payload.audience,
        target_listener_id=payload.listener_id,
        question=payload.question,
        note=payload.note,
    )
    db.commit()
    return _member_out(db, ev)


@member_router.post("/{evaluation_id}/pages", response_model=PageAdded)
def add_page(
    evaluation_id: str,
    payload: PageIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> PageAdded:
    n = evaluations.add_page(db, user_id, evaluation_id, payload.content_base64)
    db.commit()
    return PageAdded(pages=n)


@member_router.post("/{evaluation_id}/send", response_model=EvaluationOut)
def send_evaluation(
    evaluation_id: str, user_id: str = Depends(current_user_id), db: Session = Depends(get_db)
) -> EvaluationOut:
    sent = evaluations.send(db, user_id, evaluation_id)
    db.commit()
    out = _member_out(db, sent.evaluation)
    if sent.crisis is not None:
        out.support = SupportOut(message=safety.SUPPORT_COPY, helplines=sent.crisis.helplines)
    return out


@member_router.delete("/{evaluation_id}", response_model=EvaluationOut)
def withdraw_evaluation(
    evaluation_id: str, user_id: str = Depends(current_user_id), db: Session = Depends(get_db)
) -> EvaluationOut:
    ev = evaluations.withdraw(db, user_id, evaluation_id)
    db.commit()
    return _member_out(db, ev)


@member_router.get("/{evaluation_id}/pages/{idx}")
def my_page(
    evaluation_id: str,
    idx: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> Response:
    return _page(db, evaluations._mine(db, user_id, evaluation_id), idx)


# ---- mentor ----------------------------------------------------------------------------------


@mentor_router.get("", response_model=list[MentorEvaluationOut])
def mentor_queue(
    listener: ListenerProfile = Depends(current_listener), db: Session = Depends(get_db)
) -> list[MentorEvaluationOut]:
    return [_mentor_out(db, ev) for ev in evaluations.queue(db, listener)]


@mentor_router.get("/{evaluation_id}/pages/{idx}")
def mentor_page(
    evaluation_id: str,
    idx: int,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> Response:
    return _page(db, evaluations.for_mentor(db, listener, evaluation_id), idx)


@mentor_router.post("/{evaluation_id}/claim", response_model=MentorEvaluationOut)
def claim_evaluation(
    evaluation_id: str,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> MentorEvaluationOut:
    ev = evaluations.claim(db, listener, evaluation_id)
    db.commit()
    return _mentor_out(db, ev)


@mentor_router.post("/{evaluation_id}/return", response_model=MentorEvaluationOut)
def return_evaluation(
    evaluation_id: str,
    payload: FeedbackIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> MentorEvaluationOut:
    ev = evaluations.give_back(db, listener, evaluation_id, payload.feedback)
    db.commit()
    return _mentor_out(db, ev)
