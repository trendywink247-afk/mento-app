"""Product feedback (board A11) — "It goes straight to the Mento team. Your chats are
never attached. We also note the screen name and app version. Nothing else."

So that is all a row holds: which side of the app it came from (member / mentor), a
category, the words, the screen's route name and the app version. NO user id, no
listener id, no conversation id, no device or IP — the author is known only to the
rate limiter, as a Redis key that expires within the hour. The price, accepted: the
team cannot reply to a note or bar one author from the box.
"""

from __future__ import annotations

from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin, UUIDMixin


class ProductFeedback(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "product_feedback"

    role: Mapped[str] = mapped_column(String(16), index=True)  # member | mentor
    category: Mapped[str] = mapped_column(String(16), index=True)  # broken | confusing | idea
    text: Mapped[str] = mapped_column(Text)  # bounded by the schema (1000), PII-redacted
    screen: Mapped[str | None] = mapped_column(String(64), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
