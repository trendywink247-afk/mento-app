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
}


def label(slug: str | None) -> str | None:
    """Display label for an issue-category slug, or None if unset/unknown."""
    return ISSUE_CATEGORIES.get(slug) if slug else None
