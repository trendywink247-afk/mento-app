"""The mentor's own console (DECISIONS §I.6 / §K.9) — member PERSONAS only."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.models.enums import ListenerReportReason


class ListenerMeOut(BaseModel):
    """The authenticated listener's own profile + a Stream token to join channels."""

    id: str
    persona_name: str
    persona_avatar: str
    status: str
    categories: list[str]
    active_conversations: int
    max_concurrent: int
    stream_token: str
    public_line: str | None
    availability_note: str | None
    # Rotating names (DECISIONS §L.6): when this name is replaced (next 04:00 IST, as
    # UTC). Null while rotation is switched off.
    name_changes_at: str | None = None
    # The mentor's own face — the SAME animal + wash members see for them (Mentor Home's
    # presence card, the mentor chat's peek). services/mentor_face.py.
    companion_animal: str = "Owl"
    companion_colour: str = "sage"


class ListenerProfileEditIn(BaseModel):
    """PUT /listener/me/profile (spec 2026-09-06 §3.3). PATCH semantics on a PUT:
    a field omitted from the request body is left unchanged; a field present as
    `null`/empty string clears it. See `model_fields_set` in the router."""

    public_line: str | None = Field(default=None, max_length=120)
    availability_note: str | None = Field(default=None, max_length=60)


class DevListenerItem(BaseModel):
    """Dev-only roster row for the /listener no-token picker (never served in prod)."""

    id: str
    persona_name: str
    persona_avatar: str
    status: str
    # The mentor's face (services/mentor_face.py) — the picker draws it, never a landscape.
    companion_animal: str = "Owl"
    companion_colour: str = "sage"


class DevTokenOut(BaseModel):
    """Dev-only: a freshly minted console token for a picked listener."""

    token: str


class ListenerStatusIn(BaseModel):
    # offline stays a seed/admin state — the console only toggles presence.
    status: Literal["online", "away"]


class ListenerConversationItem(BaseModel):
    """A conversation as the listener sees it: the MEMBER's persona, never their
    identity — and none of the member's privacy controls (lock/PIN are theirs).
    ``member_masked`` surfaces only THAT the member set a Panda Mask (so the
    listener sees "away" instead of silence), never the mask text itself."""

    id: str
    status: str
    user_persona_name: str
    user_persona_avatar: str
    stream_channel_id: str | None
    member_masked: bool
    created_at: str
    ended_at: str | None
    # This member and the mentor are in touch (a per-row flag — never a roster/count).
    in_touch: bool = False
    # Snooze 24 h (board A10): when the snooze ends (ISO UTC) while it is open; null
    # otherwise. Snoozed rows sort after the un-snoozed active ones.
    snoozed_until: str | None = None
    # The MEMBER's growth companion in their colour (board A10 rows) — the same two
    # values the member brief carries. Never the companion's name (private, lane u7).
    user_companion_animal: str | None = None
    user_companion_colour: str | None = None


class SnoozeOut(BaseModel):
    """POST / DELETE /listener/me/conversations/{id}/snooze."""

    id: str
    snoozed_until: str | None


class MemberBriefOut(BaseModel):
    """Mentee brief, "Context for care" (spec 2026-09-06 §4.3). Anonymous persona
    + companion + coarse Path lens + topic + safety count — never age, email, or
    identity (T&S #7). `member_masked` is the same Panda-Mask signal
    `ListenerConversationItem` carries: the listener sees "away", never why."""

    persona_name: str
    persona_avatar: str
    companion_animal: str | None
    companion_colour: str | None
    community_slug: str | None
    community_label: str | None
    journey_stage: str | None
    journey_stage_label: str | None
    issue_category: str | None
    issue_category_label: str | None
    created_at: str
    last_message_at: str | None
    member_masked: bool
    safety_flags_open: int
    care_prompt: str
    in_touch: bool = False


class ListenerRequestItem(BaseModel):
    id: str
    intro_message: str | None
    issue_category: str | None
    requester_persona_name: str
    created_at: str
    # The member's companion in their colour (board A10's request card) and the topic's
    # human label ("Exam stress", never the slug). Never the companion's name.
    requester_companion_animal: str | None = None
    requester_companion_colour: str | None = None
    issue_category_label: str | None = None


class ListenerReportIn(BaseModel):
    """Mentor-side report (spec 2026-09-05 §5). Reason is the single-source-of-truth
    `ListenerReportReason` enum (app/models/enums.py) so the moderation queue can
    group; the note is short and optional."""

    reason: ListenerReportReason
    note: str | None = Field(default=None, max_length=300)
