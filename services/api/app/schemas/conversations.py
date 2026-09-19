"""The member's conversations: My Chats, the options sheet, reflection."""

from __future__ import annotations

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
    is_locked: bool
    created_at: str
    ended_at: str | None
    # The member's own match-time topic (slug + server label); null when none was
    # picked or the row predates the column.
    issue_category: str | None = None
    issue_category_label: str | None = None


class VerifyPinRequest(BaseModel):
    pin: str = Field(pattern=r"^\d{4}$")


class ConversationState(BaseModel):
    """Echoed back so the client can reflect the options sheet without guessing."""

    id: str
    status: str
    is_locked: bool
    is_paused: bool
    status_mask: str | None = None


class ReflectionIn(BaseModel):
    energy: int = Field(ge=1, le=5)  # 1 = left drained … 5 = left energized
