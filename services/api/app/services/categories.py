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


# Board A37's time-of-day chips (`ListenerApplicationIn.available_times`), in the
# order a day reads, worded for the same member-facing caption "usually here {note}".
AVAILABLE_TIMES: dict[str, str] = {
    "mornings": "mornings",
    "afternoons": "afternoons",
    "evenings": "evenings",
    "late_nights": "late nights",
    "weekends": "weekends",
}


def ordered_times(times: list[str] | None) -> list[str]:
    """Known slugs only, de-duplicated, in day order."""
    wanted = set(times or [])
    return [slug for slug in AVAILABLE_TIMES if slug in wanted]


def availability_note(times: list[str] | None, commitment: str) -> str | None:
    """The member-facing availability note an approval seeds: the chips when there are
    any ("mornings and weekends"), else the single-choice commitment's wording. Max 60
    characters (ListenerProfile.availability_note); all five chips fit."""
    words = [AVAILABLE_TIMES[slug] for slug in ordered_times(times)]
    if words:
        note = words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"
        return note[:60]
    return AVAILABILITY_NOTES.get(commitment, commitment.strip()[:60] or None)
