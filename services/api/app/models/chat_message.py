"""Own-chat message store (WS5 T5.1): the bodies Stream used to hold.

`seq` is a per-conversation counter, so a reconnecting client asks for "everything after
seq N" and can never miss or duplicate a message. `client_id` is the sender's idempotency
key: a retried send returns the stored row instead of writing a second one. Both are
allocated and checked under the conversation's row lock (services/chat.py), which is what
makes them exact — the unique constraints are the backstop. Clean Wipe is a plain DELETE
of these rows (services/chat.py::wipe); deleting the conversation cascades.
"""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin

SENDER_KINDS = ("member", "mentor")


class ChatMessage(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conversation_seq"),
        UniqueConstraint(
            "conversation_id", "sender_id", "client_id", name="uq_chat_messages_client_id"
        ),
    )

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    # "member" | "mentor". The id alone is ambiguous across the two tables, and every
    # reader (push, console, safety desk) needs to know which side wrote.
    sender_kind: Mapped[str] = mapped_column(String(8))
    sender_id: Mapped[str] = mapped_column(String(36))
    seq: Mapped[int] = mapped_column(BigInteger)
    client_id: Mapped[str] = mapped_column(String(64))
    body: Mapped[str] = mapped_column(Text)

    # Signal only, like SafetyFlag: the helpline card is rebuilt from it on replay.
    crisis_signal: Mapped[str | None] = mapped_column(String(32), nullable=True)
    redacted: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class ChatReadMarker(Base):
    """How far each side has read. One row per (conversation, reader)."""

    __tablename__ = "chat_read_markers"

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE"), primary_key=True
    )
    reader_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    last_read_seq: Mapped[int] = mapped_column(BigInteger, default=0)
