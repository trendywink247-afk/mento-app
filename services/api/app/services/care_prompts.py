"""Care prompts for the mentor console's "A gentle next step" (spec 2026-09-06
§4.5). Server data like paths_data.py — Calm register, second person, one
sentence, never diagnostic. English only in v1 (chat/server content is
untranslated per CLAUDE.md's i18n row).

`pick` is deterministic per conversation (hashed on the conversation id) so a
brief never fidgets: the same chat always shows the same prompt.
"""

from __future__ import annotations

import hashlib

PROMPTS: dict[str, list[str]] = {
    "general": [
        "Ask what's been sitting heaviest today.",
        "Ask what would make the next hour a little easier.",
        "Reflect back the feeling under what they just said.",
        "Ask what's helped before, even a little.",
        "Ask if they'd like to just be heard right now, or want ideas.",
    ],
    "exam_stress": [
        "Ask what one small thing would make tomorrow lighter.",
        "Ask when they last felt like themselves, even for an hour.",
        "Reflect back the exact words they used for the pressure.",
        "Ask what they've already tried, and notice the effort.",
        "Ask who else knows how heavy it feels right now.",
    ],
    "loneliness": [
        "Ask who, if anyone, they've told about feeling this way.",
        "Ask what a good day used to look like for them.",
        "Reflect back how long this feeling has been sitting with them.",
        "Ask what would make today feel a little less alone.",
        "Notice out loud that reaching out tonight took something.",
    ],
    "family": [
        "Ask what they wish their family understood right now.",
        "Reflect back the specific thing that was said or done.",
        "Ask what support would actually feel supportive.",
        "Ask how long this has been building.",
        "Ask what they need before anything else — space, or to be heard.",
    ],
    "career_doubt": [
        "Ask what's underneath the doubt — fear, tiredness, or comparison.",
        "Ask what they'd tell a friend in the exact same spot.",
        "Reflect back what they've already built, not just what's missing.",
        "Ask what a small next step could look like, not the whole path.",
        "Ask whose voice this doubt sounds like.",
    ],
    "relationships": [
        "Ask what they need most right now — to vent, or to think it through.",
        "Reflect back what they said mattered most to them here.",
        "Ask what's changed recently in how this feels.",
        "Ask what they've already tried to say, and how it landed.",
        "Ask what would feel like a fair outcome for them.",
    ],
    "life": [
        "Ask what's been on their mind the most today.",
        "Ask what would make this week feel more manageable.",
        "Reflect back the feeling under what they just said.",
        "Ask what's helped them get through hard stretches before.",
        "Ask what they need most right now — company, or a plan.",
    ],
    "feeling_stuck": [
        "Ask where they feel most stuck right now, in one sentence.",
        "Ask what the smallest possible next step would look like.",
        "Reflect back how long they have been carrying this.",
        "Ask what has moved, even a little, since it started.",
        "Ask whether they want to be heard first or to think it through.",
    ],
    "motivation": [
        "Ask what used to make this feel worth it.",
        "Ask what a realistic day would look like, not a perfect one.",
        "Reflect back the effort they have already put in.",
        "Ask what is draining their energy most at the moment.",
        "Ask what one thing would make tomorrow feel a little easier to start.",
    ],
}


def pick(issue_category: str | None, seed: str) -> str:
    """A stable prompt for this category (or general), keyed on `seed` (usually
    the conversation id) so the same chat always shows the same prompt."""
    prompts = PROMPTS.get(issue_category or "general", PROMPTS["general"])
    index = int(hashlib.sha1(seed.encode()).hexdigest(), 16) % len(prompts)
    return prompts[index]
