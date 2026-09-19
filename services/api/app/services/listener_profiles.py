"""Member-facing listener cards — the anonymous persona a member sees in Browse and
in the chat header (T&S #7: persona only, never identity). Shared by the listeners
router (by id) and the conversation router (by conversation), so it lives here rather
than in either router.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus
from app.models.favourite import FavouriteListener
from app.models.listener import ListenerProfile
from app.models.mentor_link import MentorLink
from app.schemas import ListenerOut, ListenerProfileOut
from app.services import in_touch, mentor_names

# Conversation statuses that count toward "conversations held" on a mentor
# profile — spec 2026-09-06 §3.3: the count is about the mentor's experience,
# so a wiped conversation (member-side hard delete) still counts.
_HELD_STATUSES = (ConversationStatus.active, ConversationStatus.ended, ConversationStatus.wiped)


def is_favourite(db: Session, user_id: str, listener_id: str) -> bool:
    return db.get(FavouriteListener, {"user_id": user_id, "listener_id": listener_id}) is not None


def card(
    li: ListenerProfile, *, is_favourite: bool = False, link: MentorLink | None = None
) -> ListenerOut:
    """`link` = the caller's ACCEPTED stay-in-touch link with this mentor, if any."""
    return ListenerOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        gender=li.gender.value,
        categories=li.categories or [],
        status=li.status.value,
        available=li.status == ListenerStatus.online
        and li.active_conversations < li.max_concurrent,
        is_favourite=is_favourite,
        in_touch=link is not None,
        first_met_as=(
            mentor_names.first_met_label(link.first_met_as, li.persona_name) if link else None
        ),
    )


def profile(db: Session, li: ListenerProfile, user_id: str) -> ListenerProfileOut:
    """The full "Two in the room" profile (spec §3.3). Shared by the by-id (Browse)
    and by-conversation (chat header) routes."""
    conversations_held = db.scalar(
        select(func.count())
        .select_from(Conversation)
        .where(Conversation.listener_id == li.id, Conversation.status.in_(_HELD_STATUSES))
    )
    link = in_touch.in_touch_listener_ids(db, user_id).get(li.id)
    return ListenerProfileOut(
        id=li.id,
        persona_name=li.persona_name,
        persona_avatar=li.persona_avatar,
        gender=li.gender.value,
        categories=li.categories or [],
        community_slug=li.community_slug,
        status=li.status.value,
        available=li.status == ListenerStatus.online
        and li.active_conversations < li.max_concurrent,
        public_line=li.public_line,
        availability_note=li.availability_note,
        listening_since=li.created_at.date().isoformat(),
        conversations_held=conversations_held or 0,
        is_favourite=is_favourite(db, user_id, li.id),
        in_touch=link is not None,
        first_met_as=(
            mentor_names.first_met_label(link.first_met_as, li.persona_name) if link else None
        ),
    )
