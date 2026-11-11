"""Who can see a pending question in their inbox — ONE rule, two uses.

`inbox_clause(listener_id, certified)` is the WHERE clause of GET /listener/me/requests: a
request addressed to this mentor, or a broadcast (DECISIONS section P.4) offered to their
audience that they have not passed on, from a member who has not blocked them and is not
their own application's applicant.

`recipient_ids(db, request)` asks the SAME clause the other way round — which approved
mentors would see this request — so live events (`request.new` / `request.gone`) reach
exactly the mentors whose inbox it is in. The clause is written over SQL expressions, so
the listing binds this mentor's values and the recipient query binds every mentor's columns.
"""

from __future__ import annotations

from sqlalchemy import and_, literal, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from app.models.enums import VettingStatus
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.moderation import ModerationEvent
from app.models.request import ConversationRequest, RequestPass


def _audience_ok(certified) -> ColumnElement[bool]:
    """`audience` values a mentor may take (matching.audiences_for): "any" for everyone,
    "in_service" for Mento Verified mentors, "peer" for the others; nothing else."""
    a = ConversationRequest.audience
    return or_(
        a == "any",
        and_(a == "in_service", certified.is_(True)),
        and_(a == "peer", certified.is_(False)),
    )


def inbox_clause(listener_id, certified) -> ColumnElement[bool]:
    """Status is NOT part of it: the listing adds `status == pending` itself."""
    if isinstance(listener_id, str):
        listener_id = literal(listener_id)
    if isinstance(certified, bool):
        certified = literal(certified)
    return or_(
        ConversationRequest.target_listener_id == listener_id,
        and_(
            ConversationRequest.broadcast.is_(True),
            ConversationRequest.target_listener_id.is_(None),
            _audience_ok(certified),
            ~select(RequestPass.id)
            .where(
                RequestPass.request_id == ConversationRequest.id,
                RequestPass.listener_id == listener_id,
            )
            .correlate_except(RequestPass)
            .exists(),
            ~select(ModerationEvent.id)
            .where(
                ModerationEvent.reporter_id == ConversationRequest.requester_id,
                ModerationEvent.subject_id == listener_id,
                ModerationEvent.blocked.is_(True),
            )
            .correlate_except(ModerationEvent)
            .exists(),
            ~select(ListenerApplication.id)
            .where(
                ListenerApplication.listener_id == listener_id,
                ListenerApplication.user_id == ConversationRequest.requester_id,
            )
            .correlate_except(ListenerApplication)
            .exists(),
        ),
    )


def recipient_ids(db: Session, request: ConversationRequest | str) -> list[str]:
    """Approved mentors whose inbox holds this request right now (status aside). A personal
    request is one query returning its target; a broadcast, every mentor in its audience."""
    request_id = request if isinstance(request, str) else request.id
    return list(
        db.scalars(
            select(ListenerProfile.id).where(
                ListenerProfile.vetting_status == VettingStatus.approved,
                select(ConversationRequest.id)
                .where(
                    ConversationRequest.id == request_id,
                    inbox_clause(ListenerProfile.id, ListenerProfile.certified_exam),
                )
                .exists(),
            )
        )
    )
