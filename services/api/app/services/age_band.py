"""A member's age as a coarse band for the mentor reading a request (founder, 2026-11-10).

Mentors see "18–24", never a date of birth or an exact age. The app is 18+, so there is no band below it.
"""

from __future__ import annotations

from datetime import UTC, date, datetime

BANDS = ((24, "18–24"), (34, "25–34"), (44, "35–44"))


def age_band(dob: date | None, today: date | None = None) -> str | None:
    if dob is None:
        return None
    today = today or datetime.now(UTC).date()
    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
    if age < 18:
        return None
    for top, label in BANDS:
        if age <= top:
            return label
    return "45+"
