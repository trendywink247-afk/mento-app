"""Issue categories: the topic a member picks at match time (General's chip or a
Personal request), and the focus a listener lists on their profile. Server data
by convention (like paths_data.py) so every surface — seeds, Browse chips, the
mentor brief — reads the same labels from one place.
"""

from __future__ import annotations

ISSUE_CATEGORIES: dict[str, str] = {
    "exam_stress": "Exam stress",
    "loneliness": "Loneliness",
    "family": "Family",
    "career_doubt": "Career doubt",
    "relationships": "Relationships",
    "life": "Life in general",
    "feeling_stuck": "Feeling stuck",
    "motivation": "Motivation",
}


def label(slug: str | None) -> str | None:
    """Display label for an issue-category slug, or None if unset/unknown."""
    return ISSUE_CATEGORIES.get(slug) if slug else None


# The four `ListenerApplicationIn.availability` Literal values, reworded to read
# naturally inside the member-facing caption "usually here {note}" (spec
# 2026-09-06 §3.2) — approval seeds ListenerProfile.availability_note from this,
# not the raw application slug.
AVAILABILITY_NOTES: dict[str, str] = {
    "few_hours": "a few hours a week",
    "most_evenings": "most evenings",
    "weekends": "weekends",
    "varies": "when I can",
}
