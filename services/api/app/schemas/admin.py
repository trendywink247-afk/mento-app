"""Admin dashboard (web-only, audited)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AdminMeOut(BaseModel):
    id: str
    name: str
    role: str


class AttentionItem(BaseModel):
    kind: str
    text: str
    href: str


class AdminOverviewOut(BaseModel):
    members_today: int
    matches_today: int
    active_conversations: int
    listeners_online: int
    flags_unreviewed: int
    reports_unreviewed: int
    attention: list[AttentionItem]


class AdminFlagItem(BaseModel):
    id: str
    signal: str
    conversation_id: str | None
    member_persona: str | None
    listener_persona: str | None
    reviewed: bool
    created_at: str


class AdminFlagReviewIn(BaseModel):
    action: Literal["helpline_shown", "escalated", "no_action"]
    note: str | None = Field(default=None, max_length=500)


class AdminMessageItem(BaseModel):
    id: str
    text: str
    user_persona: str
    at: str


class AdminListenerItem(BaseModel):
    id: str
    persona_name: str
    persona_avatar: str
    vetting_status: str
    status: str
    categories: list[str]
    active_conversations: int
    max_concurrent: int
    rank: int
    public_line: str | None
    # A live mentor asked the team to step their mentor side back (lane u14). The
    # panel lists these first while the side is still approved; suspend handles it.
    step_back_requested_at: str | None = None
    step_back_reason: str | None = None


class AdminListenerCreateIn(BaseModel):
    categories: list[str] = []
    max_concurrent: int = Field(default=3, ge=1, le=20)


class AdminListenerPatchIn(BaseModel):
    categories: list[str] | None = None
    max_concurrent: int | None = Field(default=None, ge=1, le=20)
    rank: int | None = None


class AdminConsoleLinkOut(BaseModel):
    url: str


class AdminReconcileOut(BaseModel):
    """Result of the capacity reconcile action: stale chats ended + counters fixed."""

    stale_ended: int
    listeners_corrected: int
    presence_swept: int = 0


class AdminHealthOut(BaseModel):
    db_ok: bool
    redis_ok: bool
    stream_configured: bool
    last_webhook_at: str | None
    rate_limiter_ok: bool


class AdminContributionItem(BaseModel):
    id: str
    amount_paise: int
    status: str
    created_at: str


class AdminAccountItem(BaseModel):
    id: str
    name: str
    role: str
    status: str
    created_at: str


class AdminCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class AdminCreatedOut(BaseModel):
    id: str
    url: str


class AdminAuditItem(BaseModel):
    id: str
    admin_name: str
    action: str
    subject_type: str | None
    subject_id: str | None
    created_at: str


class ModerationItem(BaseModel):
    id: str
    reporter_id: str | None
    reporter_kind: str
    # NULL when the reported member has since erased their account (DELETE /me).
    subject_id: str | None
    conversation_id: str | None
    level: int
    reason: str | None
    blocked: bool
    reviewed: bool
    created_at: str


class AdminApplicationItem(BaseModel):
    id: str
    persona_name: str
    motivation: str
    communities: list[str]
    availability: str
    # Board A37 chips, day order; [] for an application from an older build.
    available_times: list[str] = []
    email: str | None
    mentor_interest: bool
    status: str
    created_at: str


class AdminApplicationDeclineIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)
