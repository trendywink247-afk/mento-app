"""Member-facing mentor discovery, profiles and Personal requests."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.schemas.in_touch import StayInTouchOut


class ListenerOut(BaseModel):
    """Anonymous persona card — no real names/photos/star ratings in v1 (T&S #7)."""

    id: str
    persona_name: str
    persona_avatar: str
    gender: str
    categories: list[str]
    status: str
    available: bool
    # DEPRECATED (DECISIONS §L.6): the one-sided favourite is replaced by the consented
    # "stay in touch". Still served so shipped builds keep working.
    is_favourite: bool
    # Stay in touch: this member has an ACCEPTED link with this mentor. Browse puts
    # these first. `first_met_as` is set once the mentor's name has changed since.
    in_touch: bool = False
    first_met_as: str | None = None
    # One mentor, one face (services/mentor_face.py): the companion animal + wash colour
    # every screen draws for this mentor. Stable — never rotates with the name (§L.6 l).
    companion_animal: str = "Owl"
    companion_colour: str = "sage"


class ListenerProfileOut(BaseModel):
    """The member-side mentor profile, "Two in the room" (spec 2026-09-06 §3.3).
    Keyed by conversation (`GET /conversations/{id}/mentor`) or by listener id
    (`GET /listeners/{id}`, Browse). Anonymous persona only — T&S #7."""

    id: str
    persona_name: str
    persona_avatar: str
    gender: str
    categories: list[str]
    community_slug: str | None
    status: str
    available: bool
    public_line: str | None
    availability_note: str | None
    listening_since: str  # ISO date of ListenerProfile.created_at
    conversations_held: int
    is_favourite: bool  # DEPRECATED — see ListenerOut
    in_touch: bool = False
    first_met_as: str | None = None
    # One mentor, one face (services/mentor_face.py): the companion animal + wash colour
    # every screen draws for this mentor. Stable — never rotates with the name (§L.6 l).
    companion_animal: str = "Owl"
    companion_colour: str = "sage"
    # The member-facing words for `categories`, same order (services/categories.py), so
    # the app never shows a raw slug. Additive.
    category_labels: list[str] = []


class ConversationMentorOut(ListenerProfileOut):
    """`GET /conversations/{id}/mentor` — the mentor's profile PLUS the member's own
    topic for THIS conversation (the chat header's topic chip). The topic is the
    member's own match-time choice; nothing here says anything new about either
    person to the other side (T&S #7). Historic rows: both null."""

    issue_category: str | None = None
    issue_category_label: str | None = None
    # The member's stay-in-touch standing with this mentor (same payload as
    # GET /conversations/{id}/stay-in-touch) — one call draws the whole profile.
    stay_in_touch: StayInTouchOut | None = None
    # Same as ConversationListItem.reply_within_a_day — the chat header's kind line.
    reply_within_a_day: bool = False


class PersonalRequestIn(BaseModel):
    intro_message: str = Field(min_length=1, max_length=160)
    issue_category: str | None = Field(default=None, max_length=40)


class RequestOut(BaseModel):
    id: str
    status: str
    target_listener_id: str | None
    intro_message: str | None
    conversation_id: str | None
    created_at: str
    # The letter's strip, from the server and nowhere else (board A04): `seen_at` is when
    # the question first appeared in the mentor's console inbox; `replying` is their yes
    # (the chat is open). A pending, unseen question lights "Sent" only.
    seen_at: str | None = None
    replying: bool = False
    # The mentor this request went to, as every screen draws them (a Personal request's
    # target; null for anything else). Lets the A04 letter paint the right face.
    listener_companion_animal: str | None = None
    listener_companion_colour: str | None = None
