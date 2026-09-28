"""Own-chat message store (WS5 T5.1; partitioned + encrypted in T5.6): the bodies Stream
used to hold.

`seq` is a per-conversation counter, so a reconnecting client asks for "everything after
seq N" and can never miss or duplicate a message. `client_id` is the sender's idempotency
key: a retried send returns the stored row instead of writing a second one. Both are
allocated and checked under the conversation's row lock (services/chat.py::
persist_message) — that lock IS the guarantee: a partitioned table cannot carry a unique
constraint without the partition key, so the indexes below are plain lookups.

Partitioned by month on `created_at` (RANGE). Retention drops whole partitions
(app/jobs/retention.py); Clean Wipe is a plain DELETE (services/conversations.py);
deleting the conversation cascades. `body` is AES-256-GCM ciphertext
(services/message_crypto.py) — a dump without the key holds no message text.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    LargeBinary,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import _now, _uuid

SENDER_KINDS = ("member", "mentor")
PARTITION_PREFIX = "chat_messages_p"  # chat_messages_p2026_09, …; plus _default


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_conversation_seq", "conversation_id", "seq"),
        Index("ix_chat_messages_client_id", "conversation_id", "sender_id", "client_id"),
        {"postgresql_partition_by": "RANGE (created_at)"},
    )

    # The primary key must include the partition key.
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), primary_key=True, default=_now
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now
    )

    conversation_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("conversations.id", ondelete="CASCADE")
    )
    # "member" | "mentor". The id alone is ambiguous across the two tables, and every
    # reader (push, console, safety desk) needs to know which side wrote.
    sender_kind: Mapped[str] = mapped_column(String(8))
    sender_id: Mapped[str] = mapped_column(String(36))
    seq: Mapped[int] = mapped_column(BigInteger)
    client_id: Mapped[str] = mapped_column(String(64))
    # nonce ‖ AES-256-GCM ciphertext ‖ tag, under the key named by key_id.
    body: Mapped[bytes] = mapped_column(LargeBinary)
    key_id: Mapped[str] = mapped_column(String(16))

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
