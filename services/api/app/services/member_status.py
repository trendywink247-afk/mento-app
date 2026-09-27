"""Member standing: suspend, ban, lift (T3.7). Every change is audited.

Enforcement is `security.current_user_id`, which refuses a suspended or banned
member on every member route except GET /me (403 `member_suspended` /
`member_banned`), until `banned_until` passes or the team lifts it.

Sessions are deliberately left alone. The app treats a dead refresh family as a
sign-out, and an anonymous account cannot be got back — revoking would turn a
three-day suspension into losing everything. The 403s do the work.

A new account from the install of a currently blocked member is FLAGGED — an
unreviewed moderation event from `system` — never refused: installs are shared.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin import AdminAccount
from app.models.enums import MemberStatus, ModerationLevel, ReporterKind
from app.models.mentor_link import MentorLink
from app.models.moderation import ModerationEvent
from app.models.user import User
from app.services import audit, conversations, in_touch

REJOIN_REASON = "rejoin_after_ban"


class MemberNotFound(Exception):
    pass


@dataclass(frozen=True)
class Standing:
    status: MemberStatus
    until: datetime | None


def _aware(at: datetime | None) -> datetime | None:
    if at is None:
        return None
    return at.replace(tzinfo=UTC) if at.tzinfo is None else at


def standing(status: MemberStatus, until: datetime | None) -> Standing:
    """The standing in force NOW — a suspension or ban whose window has passed reads
    as active (lifted lazily, nothing to sweep)."""
    until = _aware(until)
    if status != MemberStatus.active and until is not None and until <= datetime.now(UTC):
        return Standing(MemberStatus.active, None)
    return Standing(status, until if status != MemberStatus.active else None)


def _block(
    db: Session,
    admin: AdminAccount,
    user_id: str,
    new_status: MemberStatus,
    *,
    reason: str,
    until: datetime | None,
) -> list[str | None]:
    user = db.get(User, user_id)
    if user is None:
        raise MemberNotFound(user_id)
    user.status = new_status
    user.banned_until = until
    ended = conversations.end_all_for_member(db, user_id)
    # Stay-in-touch links end too, as on a block (DECISIONS §L.6).
    for listener_id in set(
        db.scalars(select(MentorLink.listener_id).where(MentorLink.user_id == user_id))
    ):
        in_touch.end_for_pair(db, user_id, listener_id)
    audit.record(
        db,
        admin,
        f"member.{new_status.value}",
        subject_type="member",
        subject_id=user_id,
        meta={
            "reason": reason,
            "until": until.isoformat() if until else None,
            "conversations_ended": len(ended),
        },
    )
    return ended


def suspend(
    db: Session, admin: AdminAccount, user_id: str, *, reason: str, until: datetime | None = None
) -> list[str | None]:
    """Suspend; ends the member's live chats. Returns the Stream channels to SEAL
    after the caller commits (conversations.seal)."""
    return _block(db, admin, user_id, MemberStatus.suspended, reason=reason, until=until)


def ban(
    db: Session, admin: AdminAccount, user_id: str, *, reason: str, until: datetime | None = None
) -> list[str | None]:
    """Ban (NULL `until` = until lifted); ends live chats like `suspend`."""
    return _block(db, admin, user_id, MemberStatus.banned, reason=reason, until=until)


def lift(db: Session, admin: AdminAccount, user_id: str, *, reason: str) -> None:
    user = db.get(User, user_id)
    if user is None:
        raise MemberNotFound(user_id)
    user.status = MemberStatus.active
    user.banned_until = None
    audit.record(
        db,
        admin,
        "member.lifted",
        subject_type="member",
        subject_id=user_id,
        meta={"reason": reason},
    )


def flag_rejoin(db: Session, new_user: User) -> bool:
    """At signup: when another account from this install is currently suspended or
    banned, file an unreviewed `system` moderation event about the NEW account. The
    caller commits. Returns whether it flagged."""
    if not new_user.install_hash:
        return False
    rows = db.execute(
        select(User.status, User.banned_until).where(
            User.install_hash == new_user.install_hash,
            User.id != new_user.id,
            User.status != MemberStatus.active,
        )
    ).all()
    if not any(standing(s, u).status != MemberStatus.active for s, u in rows):
        return False
    db.add(
        ModerationEvent(
            reporter_id=None,
            reporter_kind=ReporterKind.system,
            subject_id=new_user.id,
            level=ModerationLevel.warning,
            reason=REJOIN_REASON,
        )
    )
    return True
