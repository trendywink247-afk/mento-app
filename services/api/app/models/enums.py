"""Enumerations used across models and schemas."""

from __future__ import annotations

import enum


class Gender(str, enum.Enum):
    female = "female"
    male = "male"
    nonbinary = "nonbinary"
    undisclosed = "undisclosed"


class ConversationType(str, enum.Enum):
    anon = "anon"  # Module A — anonymous emotional support
    mentoring = "mentoring"  # Module B — deferred


class ConversationStatus(str, enum.Enum):
    active = "active"
    ended = "ended"
    wiped = "wiped"  # messages deleted on both sides (server + device)


class RequestKind(str, enum.Enum):
    general = "general"  # match to next-available listener
    personal = "personal"  # directed at a specific listener


class RequestStatus(str, enum.Enum):
    pending = "pending"
    matched = "matched"
    declined = "declined"
    expired = "expired"


class ListenerStatus(str, enum.Enum):
    online = "online"
    away = "away"
    offline = "offline"


class VettingStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    suspended = "suspended"


class SafetySignal(str, enum.Enum):
    self_harm = "self_harm"
    suicidal = "suicidal"
    abuse = "abuse"
    none = "none"


class JournalChannel(str, enum.Enum):
    finance = "finance"
    mood = "mood"
    mentor_notes = "mentor_notes"
    gratitude = "gratitude"
    panda_wisdom = "panda_wisdom"


class ModerationLevel(int, enum.Enum):
    redirect = 1
    warning = 2
    suspension = 3
    ban = 4


class AdminRole(str, enum.Enum):
    owner = "owner"
    helper = "helper"


class AdminStatus(str, enum.Enum):
    active = "active"
    revoked = "revoked"


class ApplicationStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    declined = "declined"


class ConversationEndedBy(str, enum.Enum):
    member = "member"
    listener = "listener"
    system = "system"  # reconcile sweep (abandoned chats)


class ReporterKind(str, enum.Enum):
    member = "member"
    listener = "listener"
    system = "system"  # raised by the server itself (a re-join from a banned install)


class MemberStatus(str, enum.Enum):
    """A member's standing (T3.7). Suspended/banned members are refused by every member
    route except GET /me; `users.banned_until` bounds either (NULL = until lifted)."""

    active = "active"
    suspended = "suspended"
    banned = "banned"


class ListenerReportReason(str, enum.Enum):
    abuse = "abuse"
    harassment = "harassment"
    spam = "spam"
    other = "other"


class PushOwnerKind(str, enum.Enum):
    member = "member"
    listener = "listener"


class LinkStatus(str, enum.Enum):
    """A consented "stay in touch" link between a member and a mentor (DECISIONS §L.6)."""

    pending = "pending"  # the member asked; the mentor has not answered
    accepted = "accepted"  # in touch
    declined = "declined"  # the mentor said "not now" — quiet, no penalty
    withdrawn = "withdrawn"  # the member took the ask back
    ended = "ended"  # either side ended it, or a block / report / suspension did


class LinkEndedBy(str, enum.Enum):
    member = "member"
    listener = "listener"
    system = "system"  # block, report or suspension
