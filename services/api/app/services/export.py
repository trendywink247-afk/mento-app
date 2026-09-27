"""The member's data export (T2.5, GET /me/export) — erasure's inventory, read back.

Whatever Start fresh deletes as the member's own (`erasure.MEMBER_TABLES`), this hands
back first, one section per table; tests/test_export.py fails if the two drift.

Left out, on purpose:
- chat message text — it lives on Stream, not in our database; the member reads it in
  the app (`notes.messages` says so, rather than implying a full transcript);
- anything that belongs to someone else: other members' rows, a mentor's internal id or
  private fields (only the persona name the member already saw);
- secrets: the conversation PIN hash, the push token value;
- the team's private notes (an application's decline reason);
- the safety records held ABOUT the member for other people's protection — crisis-scan
  flags and reports mentors filed. Reports the member filed themselves are included.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.allowance import MessageAllowanceDay
from app.models.contribution import Contribution
from app.models.conversation import Conversation
from app.models.enums import PushOwnerKind, ReporterKind
from app.models.favourite import FavouriteListener
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_link import MentorLink
from app.models.moderation import ModerationEvent
from app.models.push_token import PushToken
from app.models.reflection import ConversationReflection
from app.models.request import ConversationRequest
from app.models.user import User
from app.schemas.export import (
    ExportAllowanceDay,
    ExportApplication,
    ExportContribution,
    ExportConversation,
    ExportFavourite,
    ExportJournalEntry,
    ExportLink,
    ExportNotes,
    ExportOut,
    ExportProfile,
    ExportPushDevice,
    ExportReflection,
    ExportReportFiled,
    ExportRequest,
)
from app.services import mentor_names

# erasure.MEMBER_TABLES key → the ExportOut section that carries it.
SECTIONS_BY_ERASURE_KEY = {
    "reflections": "reflections",
    "conversations": "conversations",
    "journal_entries": "journal_entries",
    "favourites": "favourites",
    "stay_in_touch_links": "stay_in_touch_links",
    "requests": "requests",
    "push_tokens": "push_devices",
    "allowance_days": "allowance_days",
    "applications": "applications",
    "contributions": "contributions",
}

NOTES = ExportNotes(
    messages=(
        "Your chat messages are not in this file. They are held by our chat provider and "
        "you can read them in the app; Start fresh deletes them there too."
    ),
    not_included=(
        "Other people's information, your conversation PIN and device token, the team's "
        "internal notes, and safety records kept to protect others."
    ),
)


def _value(v) -> str | None:  # type: ignore[no-untyped-def] — reason: any enum or None
    return None if v is None else getattr(v, "value", v)


def build(db: Session, user: User) -> ExportOut:
    uid = user.id
    convos = db.scalars(
        select(Conversation).where(Conversation.user_id == uid).order_by(Conversation.created_at)
    ).all()
    favourites = db.scalars(
        select(FavouriteListener)
        .where(FavouriteListener.user_id == uid)
        .order_by(FavouriteListener.created_at)
    ).all()
    listener_ids = {c.listener_id for c in convos} | {f.listener_id for f in favourites}
    names = (
        dict(
            db.execute(
                select(ListenerProfile.id, ListenerProfile.persona_name).where(
                    ListenerProfile.id.in_(listener_ids)
                )
            ).all()
        )
        if listener_ids
        else {}
    )
    book = mentor_names.NameBook(db, listener_ids)

    def met_as(c: Conversation) -> str | None:
        current = names.get(c.listener_id)
        return book.name_at(c.listener_id, c.created_at, current) if current else None

    convo_ids = [c.id for c in convos]
    return ExportOut(
        exported_at=datetime.now(UTC),
        notes=NOTES,
        profile=ExportProfile(
            persona_name=user.persona_name,
            persona_avatar=user.persona_avatar,
            dob=user.dob,
            age_at_signup=user.age_at_signup,
            email=user.email,
            companion_animal=user.companion_animal,
            companion_colour=user.companion_colour,
            companion_name=user.companion_name,
            community_slug=user.community_slug,
            journey_stage=user.journey_stage,
            created_at=user.created_at,
        ),
        conversations=[
            ExportConversation(
                id=c.id,
                type=_value(c.type) or "",
                status=_value(c.status) or "",
                mentor_name=met_as(c),
                issue_category=c.issue_category,
                is_locked=c.is_locked,
                is_paused=c.is_paused,
                created_at=c.created_at,
                ended_at=c.ended_at,
                ended_by=_value(c.ended_by),
            )
            for c in convos
        ],
        reflections=(
            [
                ExportReflection(
                    conversation_id=r.conversation_id, energy=r.energy, created_at=r.created_at
                )
                for r in db.scalars(
                    select(ConversationReflection)
                    .where(ConversationReflection.conversation_id.in_(convo_ids))
                    .order_by(ConversationReflection.created_at)
                ).all()
            ]
            if convo_ids
            else []
        ),
        journal_entries=[
            ExportJournalEntry(
                channel=_value(j.channel) or "",
                body=j.body,
                source=j.source,
                meta=j.meta or {},
                created_at=j.created_at,
            )
            for j in db.scalars(
                select(JournalEntry)
                .where(JournalEntry.user_id == uid)
                .order_by(JournalEntry.created_at)
            ).all()
        ],
        favourites=[
            ExportFavourite(mentor_name=names.get(f.listener_id), created_at=f.created_at)
            for f in favourites
        ],
        stay_in_touch_links=[
            ExportLink(
                conversation_id=link.conversation_id,
                status=_value(link.status) or "",
                first_met_as=link.first_met_as,
                first_met_at=link.first_met_at,
                responded_at=link.responded_at,
                ended_at=link.ended_at,
                ended_by=_value(link.ended_by),
            )
            for link in db.scalars(
                select(MentorLink).where(MentorLink.user_id == uid).order_by(MentorLink.created_at)
            ).all()
        ],
        requests=[
            ExportRequest(
                kind=_value(r.kind) or "",
                status=_value(r.status) or "",
                issue_category=r.issue_category,
                intro_message=r.intro_message,
                conversation_id=r.conversation_id,
                created_at=r.created_at,
            )
            for r in db.scalars(
                select(ConversationRequest)
                .where(ConversationRequest.requester_id == uid)
                .order_by(ConversationRequest.created_at)
            ).all()
        ],
        push_devices=[
            ExportPushDevice(platform=t.platform, created_at=t.created_at)
            for t in db.scalars(
                select(PushToken)
                .where(PushToken.owner_kind == PushOwnerKind.member, PushToken.owner_id == uid)
                .order_by(PushToken.created_at)
            ).all()
        ],
        allowance_days=[
            ExportAllowanceDay(
                day=d.day,
                sent=d.sent,
                crisis_exempt=d.crisis_exempt,
                row_cap_hits=d.row_cap_hits,
                day_cap_hits=d.day_cap_hits,
            )
            for d in db.scalars(
                select(MessageAllowanceDay)
                .where(MessageAllowanceDay.user_id == uid)
                .order_by(MessageAllowanceDay.day)
            ).all()
        ],
        applications=[
            ExportApplication(
                motivation=a.motivation,
                communities=list(a.communities or []),
                availability=a.availability,
                available_times=a.available_times,
                email=a.email,
                mentor_interest=a.mentor_interest,
                status=_value(a.status) or "",
                created_at=a.created_at,
            )
            for a in db.scalars(
                select(ListenerApplication)
                .where(ListenerApplication.user_id == uid)
                .order_by(ListenerApplication.created_at)
            ).all()
        ],
        contributions=[
            ExportContribution(
                amount_paise=c.amount_paise,
                status=c.status,
                label=c.label,
                razorpay_order_id=c.razorpay_order_id,
                razorpay_payment_id=c.razorpay_payment_id,
                created_at=c.created_at,
            )
            for c in db.scalars(
                select(Contribution)
                .where(Contribution.user_id == uid)
                .order_by(Contribution.created_at)
            ).all()
        ],
        reports_filed=[
            ExportReportFiled(
                conversation_id=m.conversation_id,
                level=int(_value(m.level) or 0),
                reason=m.reason,
                blocked=m.blocked,
                created_at=m.created_at,
            )
            for m in db.scalars(
                select(ModerationEvent)
                .where(
                    ModerationEvent.reporter_kind == ReporterKind.member,
                    ModerationEvent.reporter_id == uid,
                )
                .order_by(ModerationEvent.created_at)
            ).all()
        ],
    )
