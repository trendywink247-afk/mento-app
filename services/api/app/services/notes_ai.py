"""Journal note-sorting — the opt-in AI that groups a user's own entries into themes.

This is the ONE sanctioned content egress in the app, and it is deliberately narrow:
  - opt-in per action (the user taps "Organize"), never automatic;
  - only the user's OWN journal entries (mood/finance/gratitude) — never live chat,
    never mentor-notes (which contain the other party's words), never crisis content;
  - dark by default: with no `gemini_api_key` the feature is simply off (NotesAiDisabled).

Raw HTTP against the Gemini API (no SDK — same posture as lib/analytics and the Stream
client): a closed request shape, a strict JSON response contract, and no PII beyond the
entry bodies the user themselves chose to keep.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field

import httpx

from app.config import get_settings

logger = logging.getLogger("mento.notes_ai")

_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

_PROMPT = (
    "You are a gentle journaling assistant. Group the user's own short journal entries "
    "into 2–5 themes. For each theme give a short title (2–4 words) and a one-sentence, "
    "warm, non-clinical summary. Also give a one-sentence overall reflection. Do NOT "
    "diagnose, do NOT give medical or crisis advice, do NOT invent facts not present in "
    "the entries. Respond with ONLY JSON of the exact shape:\n"
    '{"overview": "string", "themes": [{"title": "string", "summary": "string", '
    '"count": number}]}\n\nEntries:\n'
)


class NotesAiDisabled(Exception):
    """No Gemini key configured — the feature is dark."""


@dataclass
class Theme:
    title: str
    summary: str
    count: int


@dataclass
class OrganizeResult:
    overview: str
    themes: list[Theme] = field(default_factory=list)


def is_enabled() -> bool:
    return bool(get_settings().gemini_api_key)


def organize(entry_bodies: list[str]) -> OrganizeResult:
    """Group the given entry texts into themes via Gemini. Raises NotesAiDisabled when
    unconfigured; raises on transport/parse failure so the caller can 502 honestly."""
    settings = get_settings()
    if not settings.gemini_api_key:
        raise NotesAiDisabled()

    numbered = "\n".join(f"- {b.strip()}" for b in entry_bodies if b and b.strip())
    body = {
        "contents": [{"parts": [{"text": _PROMPT + numbered}]}],
        "generationConfig": {"temperature": 0.4, "responseMimeType": "application/json"},
    }
    url = _ENDPOINT.format(model=settings.gemini_model)
    resp = httpx.post(
        url,
        params={"key": settings.gemini_api_key},
        json=body,
        timeout=20.0,
    )
    resp.raise_for_status()
    data = resp.json()
    text = data["candidates"][0]["content"]["parts"][0]["text"]
    parsed = json.loads(text)
    themes = [
        Theme(
            title=str(t.get("title", ""))[:60],
            summary=str(t.get("summary", ""))[:240],
            count=int(t.get("count", 0) or 0),
        )
        for t in parsed.get("themes", [])
    ]
    return OrganizeResult(overview=str(parsed.get("overview", ""))[:280], themes=themes)
