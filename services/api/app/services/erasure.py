"""Member erasure — "Start fresh" really erases (DELETE /me; audit F24, DECISIONS §L.11).

What goes, what stays, and why (the privacy policy, docs/PRIVACY.md §5, says the same):

DELETED — the member row (persona, DOB, optional email, companion, path choice) and
everything keyed to it: journals (every channel, Mentor Notes included), favourites,
stay-in-touch links (ended first, so the mentor side updates at once), Personal
requests, push tokens, sign-in sessions (refresh tokens), the message-allowance ledger,
their reflections, applications that never became a live mentor, and their conversations — each active one is ENDED
through `services/conversations` (the mentor's seat frees at once), each channel is
hard-deleted on Stream exactly as Clean Wipe does, and the conversation rows go too.
Last, the member's Stream user.

KEPT, detached from the person —
- safety flags (T&S #1): signal + matched terms + time, never a body; `user_id` becomes
  NULL. The flag keeps its `conversation_id`, which now resolves to nothing (the row is
  deleted) — it only groups flags that came from the same chat.
- moderation events: a report the member filed about a mentor keeps protecting other
  members (`reporter_id` → NULL); a report a mentor filed about the member stays in the
  review queue (`subject_id` → NULL).
- admin audit rows (the team's own actions) — untouched; one new row records THAT an
  erasure happened, with counts only.
- product feedback never had an author.

Dual role: while the member is ALSO a live mentor (an approved application whose mentor
profile is still approved), erasure is refused with `mentor_active` — erasing the member
would silently cut the mentor's own way back into the console and strand the people
they are talking with. Nothing is touched in that case.

Fail-safe order: (A) one DB transaction ends chats, links and requests — safe to keep
even if what follows fails; (B) Stream — every channel, then the Stream user; any
failure raises `EraseIncomplete` and NOTHING is claimed (the member row stays so the app
can retry with the same session; a channel already deleted is marked wiped, so a retry
does not repeat it); (C) one DB transaction deletes and detaches the rest.
Idempotent: a caller whose member row is already gone gets `None` (the router answers
200, a no-op).
"""

from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from app.models.admin import AdminAuditLog
from app.models.allowance import MessageAllowanceDay
from app.models.contribution import Contribution
from app.models.conversation import Conversation
from app.models.enums import (
    ApplicationStatus,
    ConversationEndedBy,
    ConversationStatus,
    LinkEndedBy,
    LinkStatus,
    PushOwnerKind,
    ReporterKind,
    RequestStatus,
    VettingStatus,
)
from app.models.erasure_receipt import ErasureReceipt
from app.models.favourite import FavouriteListener
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.listener_application import ListenerApplication
from app.models.mentor_link import MentorLink
from app.models.moderation import ModerationEvent
from app.models.push_token import PushToken
from app.models.reflection import ConversationReflection
from app.models.request import ConversationRequest
from app.models.safety import SafetyFlag
from app.models.session import Session as AuthSession
from app.models.user import User
from app.services import conversations, recovery_receipts, stream

logger = logging.getLogger("mento.erasure")

# The audit row is the system's, not an admin's: a fixed actor, never the member's id.
AUDIT_ACTOR_ID = "system"
AUDIT_ACTOR_NAME = "Member erasure"
AUDIT_ACTION = "member.erased"


# The tables whose rows are the member's own and are DELETED (the `counts` keys of
# phase C that are not "_detached"). GET /me/export hands every one of them back first
# (services/export.py; tests/test_export.py keeps the two in step) — EXCEPT "sessions"
# (WS3 T3.2): refresh-token/device metadata is deleted here too, but it is not member
# content, so it deliberately never reaches the export. The test pins this exception
# by name, not by omission — a genuinely new deleted category still trips it.
MEMBER_TABLES = (
    "reflections",
    "conversations",
    "journal_entries",
    "favourites",
    "stay_in_touch_links",
    "requests",
    "push_tokens",
    "allowance_days",
    "applications",
    "contributions",
)


class MentorActive(Exception):
    """The member is also a live mentor — refused, nothing touched."""


class EraseIncomplete(Exception):
    """Stream did not confirm a deletion. Chats are ended; nothing else is claimed."""


@dataclass
class Erased:
    conversations: int = 0
    counts: dict[str, int] = field(default_factory=dict)


def is_live_mentor(db: Session, user_id: str) -> bool:
    """An approved application whose mentor profile is still approved."""
    listener_ids = db.scalars(
        select(ListenerApplication.listener_id).where(
            ListenerApplication.user_id == user_id,
            ListenerApplication.status == ApplicationStatus.approved,
            ListenerApplication.listener_id.is_not(None),
        )
    ).all()
    if not listener_ids:
        return False
    return (
        db.scalar(
            select(ListenerProfile.id).where(
                ListenerProfile.id.in_(listener_ids),
                ListenerProfile.vetting_status == VettingStatus.approved,
            )
        )
        is not None
    )


def _phase_a_end_everything_live(db: Session, user_id: str) -> list[tuple[str, str | None]]:
    """End what is live, so the other side sees it at once. Lock order: member row →
    conversation rows (id order) → listener rows (inside `conversations.end`) → link
    rows. Returns (conversation id, channel id) for every conversation still on Stream."""
    now = datetime.now(UTC)
    convos = (
        db.execute(
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        .scalars()
        .all()
    )
    for convo in convos:
        conversations.end(db, convo, ConversationEndedBy.member)
    links = db.scalars(
        select(MentorLink)
        .where(
            MentorLink.user_id == user_id,
            MentorLink.status.in_((LinkStatus.pending, LinkStatus.accepted)),
        )
        .order_by(MentorLink.id)
        .with_for_update()
    ).all()
    for link in links:
        link.status = LinkStatus.ended
        link.ended_by = LinkEndedBy.member
        link.ended_at = now
    # A waiting Personal request leaves the mentor's inbox now, not after Stream answers.
    db.execute(
        update(ConversationRequest)
        .where(
            ConversationRequest.requester_id == user_id,
            ConversationRequest.status == RequestStatus.pending,
        )
        .values(status=RequestStatus.expired)
    )
    return [
        (c.id, c.stream_channel_id)
        for c in convos
        if c.stream_channel_id and c.status != ConversationStatus.wiped
    ]


def _phase_b_stream(db: Session, user_id: str, channels: list[tuple[str, str | None]]) -> None:
    """Hard-delete every channel, then the Stream user. A channel that is gone is marked
    wiped and committed at once, so a retry after a partial failure only does the rest.
    Never holds a transaction across an HTTP call."""
    for convo_id, channel_id in channels:
        try:
            stream.erase_channel(channel_id or "")
        except Exception as exc:  # noqa: BLE001 — any transport/API failure is the same outcome
            logger.warning("erasure: channel delete failed (%s)", type(exc).__name__)
            raise EraseIncomplete from exc
        db.execute(
            update(Conversation)
            .where(Conversation.id == convo_id)
            .values(status=ConversationStatus.wiped)
        )
        db.commit()
    try:
        stream.delete_user(user_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("erasure: Stream user delete failed (%s)", type(exc).__name__)
        raise EraseIncomplete from exc


def recovery_digest(user_id: str) -> str:
    """Domain-separated digest of a random account UUID; still pseudonymous data."""
    return hashlib.sha256(f"mento:member-erasure:v1:{user_id}".encode()).hexdigest()


def _phase_c_delete(db: Session, user_id: str) -> dict[str, int]:
    """Delete and detach the rest in ONE transaction; the caller commits."""
    convo_ids = select(Conversation.id).where(Conversation.user_id == user_id).scalar_subquery()

    def gone(stmt) -> int:  # type: ignore[no-untyped-def] — reason: SQLAlchemy DML type
        return int(db.execute(stmt).rowcount or 0)

    counts = {
        "reflections": gone(
            delete(ConversationReflection).where(
                ConversationReflection.conversation_id.in_(convo_ids)
            )
        ),
        "conversations": gone(delete(Conversation).where(Conversation.user_id == user_id)),
        "journal_entries": gone(delete(JournalEntry).where(JournalEntry.user_id == user_id)),
        "favourites": gone(delete(FavouriteListener).where(FavouriteListener.user_id == user_id)),
        "stay_in_touch_links": gone(delete(MentorLink).where(MentorLink.user_id == user_id)),
        "requests": gone(
            delete(ConversationRequest).where(ConversationRequest.requester_id == user_id)
        ),
        "push_tokens": gone(
            delete(PushToken).where(
                PushToken.owner_kind == PushOwnerKind.member,
                or_(PushToken.owner_id == user_id, PushToken.user_id == user_id),
            )
        ),
        "allowance_days": gone(
            delete(MessageAllowanceDay).where(MessageAllowanceDay.user_id == user_id)
        ),
        "applications": gone(
            delete(ListenerApplication).where(ListenerApplication.user_id == user_id)
        ),
        "contributions": gone(delete(Contribution).where(Contribution.user_id == user_id)),
        "sessions": gone(delete(AuthSession).where(AuthSession.user_id == user_id)),
        "safety_flags_detached": gone(
            update(SafetyFlag).where(SafetyFlag.user_id == user_id).values(user_id=None)
        ),
        "reports_filed_detached": gone(
            update(ModerationEvent)
            .where(
                ModerationEvent.reporter_kind == ReporterKind.member,
                ModerationEvent.reporter_id == user_id,
            )
            .values(reporter_id=None)
        ),
        "reports_about_detached": gone(
            update(ModerationEvent)
            .where(ModerationEvent.subject_id == user_id)
            .values(subject_id=None)
        ),
    }
    digest = recovery_digest(user_id)
    if db.get(ErasureReceipt, digest) is None:
        db.add(ErasureReceipt(member_digest=digest))
    gone(delete(User).where(User.id == user_id))
    # THAT an erasure happened, with counts — no member id, no persona, nothing to re-link.
    db.add(
        AdminAuditLog(
            admin_id=AUDIT_ACTOR_ID,
            admin_name=AUDIT_ACTOR_NAME,
            action=AUDIT_ACTION,
            subject_type=None,
            subject_id=None,
            meta={k: v for k, v in counts.items() if v},
        )
    )
    return counts


def erase_member(db: Session, user_id: str) -> Erased | None:
    """Erase one member completely. None = already erased (no-op). Raises MentorActive
    (nothing touched) or EraseIncomplete (chats ended; nothing else claimed)."""
    user = db.execute(select(User).where(User.id == user_id).with_for_update()).scalar_one_or_none()
    if user is None:
        db.rollback()
        return None
    if is_live_mentor(db, user_id):
        db.rollback()
        raise MentorActive

    channels = _phase_a_end_everything_live(db, user_id)
    db.commit()

    _phase_b_stream(db, user_id, channels)

    # No DB transaction held during the remote acknowledgement. A durable intent
    # may outlive a subsequent local rollback; retries are idempotent by digest.
    try:
        recovery_receipts.acknowledge(recovery_digest(user_id))
    except recovery_receipts.ReceiptUnavailable as exc:
        raise EraseIncomplete from exc

    # Re-take the member row: a second request that raced us here finds it gone and
    # returns the no-op; only one of the two deletes and audits.
    if db.execute(select(User.id).where(User.id == user_id).with_for_update()).first() is None:
        db.rollback()
        return None
    # A chat opened while Stream was being cleared (a match racing the erasure) would be
    # deleted here without its channel — refuse and let the retry end and delete it.
    straggler = db.scalar(
        select(Conversation.id).where(
            Conversation.user_id == user_id,
            or_(
                Conversation.status == ConversationStatus.active,
                (Conversation.status != ConversationStatus.wiped)
                & Conversation.stream_channel_id.is_not(None),
            ),
        )
    )
    if straggler is not None:
        db.rollback()
        raise EraseIncomplete
    counts = _phase_c_delete(db, user_id)
    db.commit()
    return Erased(conversations=counts["conversations"], counts=counts)
