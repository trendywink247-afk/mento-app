"""The mentee profile (DECISIONS R.6, R.7, R.14): what a member chose to share in the
mentorship intake form. Every field is optional. Shown only to the mentor receiving that
member's request, never with a name or contact; marks only as `marks_visibility` allows.
Deleted with the member (services/erasure.py)."""

from __future__ import annotations

from sqlalchemy import JSON, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.mixins import TimestampMixin


class MenteeProfile(TimestampMixin, Base):
    __tablename__ = "mentee_profiles"

    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The intake answers (schemas/mentee_profile.py MenteeProfileIn), validated on the way in.
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    # Who may see marks: "nobody" | "mentors" (Mentor + Mento Verified) | "everyone"
    # (mentors and listeners). Default "mentors" (R.14).
    marks_visibility: Mapped[str] = mapped_column(
        String(16), default="mentors", server_default="mentors"
    )
