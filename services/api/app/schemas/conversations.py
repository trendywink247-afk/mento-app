"""The member's conversations: My Chats, the options sheet, reflection."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class LockRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")  # simplified v1 lock: 4 digits


class UnlockRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class StatusMaskRequest(BaseModel):
    mask: str | None = Field(default=None, max_length=32)  # "Panda Mask"; null clears


class PauseRequest(BaseModel):
    paused: bool  # "Panda Pause" — mute notifications


class ReportRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


class ConversationListItem(BaseModel):
    """Row for My Chats (#54/55). Message previews come from Stream client-side."""

    id: str
    status: str
    listener_persona_name: str
    listener_persona_avatar: str
    stream_channel_id: str | None
    chat_backend: Literal["stream", "own"] = "stream"
    is_locked: bool
    created_at: str
    ended_at: str | None
    # The member's own match-time topic (slug + server label); null when none was
    # picked or the row predates the column.
    issue_category: str | None = None
    issue_category_label: str | None = None
    # Rotating names (DECISIONS §L.6). `listener_persona_name` is the mentor's name
    # TODAY while the chat is active or the member is in touch with them; an ended /
    # wiped chat with anyone else keeps the name it ended under. `first_met_as` is the
    # name at the start of this chat, set only when it differs from the one shown.
    in_touch: bool = False
    first_met_as: str | None = None
    # True while the mentor has snoozed this ACTIVE chat (board A10). The member is
    # only ever told the kind half of it — "<mentor> will reply within a day" — never
    # that it was snoozed.
    reply_within_a_day: bool = False
    # The mentor's face (services/mentor_face.py) — the same animal + wash on every screen.
    listener_companion_animal: str = "Owl"
    listener_companion_colour: str = "sage"


class VerifyPinRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class ConversationState(BaseModel):
    """Echoed back so the client can reflect the options sheet without guessing."""

    id: str
    status: str
    chat_backend: Literal["stream", "own"] = "stream"
    is_locked: bool
    is_paused: bool
    status_mask: str | None = None


class ReflectionIn(BaseModel):
    energy: int = Field(ge=1, le=5)  # 1 = left drained … 5 = left energized
