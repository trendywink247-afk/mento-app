"""GET /me/export (T2.5) — the member's own rows, in one document.

Field names are the member's words where they differ from the column (mentor_name,
push_devices). Every datetime is ISO 8601 UTC. Nothing here names another person
beyond the mentor persona the member already saw.
"""

from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel


class ExportProfile(BaseModel):
    persona_name: str
    persona_avatar: str
    dob: date | None
    age_at_signup: int | None
    email: str | None
    companion_animal: str | None
    companion_colour: str | None
    companion_name: str | None
    community_slug: str | None
    journey_stage: str | None
    created_at: datetime


class ExportConversation(BaseModel):
    id: str
    type: str
    status: str
    # The mentor's name when this chat began — the name the member met, never a later one.
    mentor_name: str | None
    issue_category: str | None
    is_locked: bool
    is_paused: bool
    created_at: datetime
    ended_at: datetime | None
    ended_by: str | None


class ExportReflection(BaseModel):
    conversation_id: str
    energy: int
    created_at: datetime


class ExportJournalEntry(BaseModel):
    channel: str
    body: str
    source: str
    meta: dict
    created_at: datetime


class ExportFavourite(BaseModel):
    mentor_name: str | None
    created_at: datetime


class ExportLink(BaseModel):
    conversation_id: str | None
    status: str
    first_met_as: str
    first_met_at: datetime
    responded_at: datetime | None
    ended_at: datetime | None
    ended_by: str | None


class ExportRequest(BaseModel):
    kind: str
    status: str
    issue_category: str | None
    intro_message: str | None
    conversation_id: str | None
    created_at: datetime


class ExportPushDevice(BaseModel):
    platform: str
    created_at: datetime


class ExportAllowanceDay(BaseModel):
    day: date
    sent: int
    crisis_exempt: int
    row_cap_hits: int
    day_cap_hits: int


class ExportApplication(BaseModel):
    motivation: str
    communities: list[str]
    availability: str
    available_times: list[str] | None
    email: str | None
    mentor_interest: bool
    status: str
    created_at: datetime


class ExportContribution(BaseModel):
    amount_paise: int
    status: str
    label: str
    razorpay_order_id: str | None
    razorpay_payment_id: str | None
    created_at: datetime


class ExportReportFiled(BaseModel):
    conversation_id: str | None
    level: int
    reason: str | None
    blocked: bool
    created_at: datetime


class ExportNotes(BaseModel):
    messages: str
    not_included: str


class ExportOut(BaseModel):
    exported_at: datetime
    notes: ExportNotes
    profile: ExportProfile
    conversations: list[ExportConversation]
    reflections: list[ExportReflection]
    journal_entries: list[ExportJournalEntry]
    favourites: list[ExportFavourite]
    stay_in_touch_links: list[ExportLink]
    requests: list[ExportRequest]
    push_devices: list[ExportPushDevice]
    allowance_days: list[ExportAllowanceDay]
    applications: list[ExportApplication]
    contributions: list[ExportContribution]
    reports_filed: list[ExportReportFiled]
