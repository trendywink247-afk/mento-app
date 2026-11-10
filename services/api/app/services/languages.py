"""The languages a mentor can talk in (founder, 2026-11-10).

A mentor names up to five when they apply and can change them later. A member never has to pick one:
the language is a PREFERENCE that puts matching mentors first in Browse and is never a filter that
hides anyone. The codes are short and fixed; the app shows each in its own script.
"""

from __future__ import annotations

# code -> English name. The app has its own native-script labels.
LANGUAGES: dict[str, str] = {
    "en": "English",
    "hi": "Hindi",
    "bn": "Bengali",
    "ta": "Tamil",
    "te": "Telugu",
    "mr": "Marathi",
    "gu": "Gujarati",
    "kn": "Kannada",
    "ml": "Malayalam",
    "pa": "Punjabi",
    "or": "Odia",
    "ur": "Urdu",
}
MAX_LANGUAGES = 5


def clean(codes: list[str] | None) -> list[str]:
    """Known codes only, de-duplicated, first-seen order, at most MAX_LANGUAGES."""
    out: list[str] = []
    for raw in codes or []:
        code = (raw or "").strip().lower()
        if code in LANGUAGES and code not in out:
            out.append(code)
    return out[:MAX_LANGUAGES]
