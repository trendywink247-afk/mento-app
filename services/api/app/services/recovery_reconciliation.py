"""Offline restore reconciliation only; no router or automatic live invocation.

The caller must isolate the restored DB and keep API, workers and outbound
integrations disabled. A supplied receipt set is NOT proof of complete coverage.
The caller owns the transaction and must separately clear/review restored jobs.
"""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.conversation import Conversation
from app.models.enums import ConversationStatus
from app.models.user import User
from app.services.erasure import MentorActive, _phase_c_delete, is_live_mentor, recovery_digest
from app.services.matching import release_listener_slot


def reconcile_restored_members(db: Session, digests: set[str]) -> int:
    if any(not isinstance(d, str) or re.fullmatch(r"[0-9a-f]{64}", d) is None for d in digests):
        raise ValueError("Invalid recovery receipt digest")
    # Offline maintenance: no traffic or workers may race this account scan.
    members = db.scalars(select(User).order_by(User.id).with_for_update()).all()
    targets = [member for member in members if recovery_digest(member.id) in digests]
    # Check every refusal before making any changes; active mentor roles require
    # separate recovery review, never an implicit privilege/account deletion.
    if any(is_live_mentor(db, member.id) for member in targets):
        raise MentorActive
    for member in targets:
        active = db.scalars(select(Conversation).where(
            Conversation.user_id == member.id,
            Conversation.status == ConversationStatus.active,
        ).order_by(Conversation.id).with_for_update()).all()
        for conversation in active:
            # Database-only seat accounting: do not emit sockets or call Stream.
            release_listener_slot(db, conversation)
        _phase_c_delete(db, member.id)
    return len(targets)
