"""The growth companion a member can pick — ONE allowed set, server-side.

Mirrors the app (`components/art/Companions.tsx` `CompanionAnimal`, `theme/companion.ts`
`CompanionColor`). The values travel to the other side of a chat (the mentor's member
brief shows the member's companion), so they are never free text.

Two ways in, deliberately different:
- `coerce_*` — onboarding. NEVER rejects: an older build with a retired colour name
  must still get a person into the app. Unknown → None, legacy casing is fixed.
- `require_*` — `PUT /me/companion`, called only by current builds. Unknown → ValueError
  (the schema turns that into a 422).

Adding an animal: add it here, to `CompanionAnimal` in the app, and to the generated
art set — `tests/test_me_companion.py` pins this list so a drift is a red test.
"""

from __future__ import annotations

import re

ANIMALS: tuple[str, ...] = (
    "Panda",
    "Dog",
    "Cat",
    "Fox",
    "Capybara",
    "Elephant",
    "Turtle",
    "Deer",
    "Owl",
)
COLOURS: tuple[str, ...] = ("terracotta", "sage", "sky", "rose", "mustard", "plum", "teal")

_ANIMAL_BY_KEY = {a.lower(): a for a in ANIMALS}
_COLOUR_BY_KEY = {c.lower(): c for c in COLOURS}


def _lookup(value: str | None, table: dict[str, str]) -> str | None:
    if not value:
        return None
    return table.get(value.strip().lower())


def coerce_animal(value: str | None) -> str | None:
    return _lookup(value, _ANIMAL_BY_KEY)


def coerce_colour(value: str | None) -> str | None:
    return _lookup(value, _COLOUR_BY_KEY)


def require_animal(value: str) -> str:
    found = _lookup(value, _ANIMAL_BY_KEY)
    if found is None:
        raise ValueError(f"unknown companion animal — expected one of: {', '.join(ANIMALS)}")
    return found


def require_colour(value: str) -> str:
    found = _lookup(value, _COLOUR_BY_KEY)
    if found is None:
        raise ValueError(f"unknown companion colour — expected one of: {', '.join(COLOURS)}")
    return found


# --- The companion's name (founder ruling 2026-09-19) --------------------------------
#
# The member's own word for their companion. PRIVATE to the member: it is returned by
# GET /me and nowhere else — not the member brief, the console, Stream, analytics or the
# admin dashboard (tests/test_companion_name.py calls every one of them). Because it is
# free text, the one rule set below keeps it a *name*: never a way to smuggle contact
# details into the app (the app mirrors these rules in lib/companionName.ts).

NAME_MAX = 24
NAME_INVALID_CODE = "companion_name_invalid"
NAME_INVALID_DETAIL = "Just a name works best here, without links, emails or phone numbers."

# Control characters (Cc) and the invisible direction / zero-width marks that can make a
# name render as something else. ZWJ / ZWNJ (U+200D / U+200C) stay: Devanagari needs them.
_INVISIBLE = re.compile(
    r"[\x00-\x1f\x7f-\x9f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]"
)
_URL = re.compile(
    r"(://|\bwww\.|\b[\w-]+\.(com|net|org|in|io|co|app|me|ly|gg|xyz|info|link|site|"
    r"online|biz|us|uk|to|tk|dev|ai)\b)",
    re.IGNORECASE,
)
_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
# Seven or more digits in one run, allowing the usual separators (+91 98765 43210,
# 987-654-3210, (022) 2345 6789). `\d` is Unicode-aware, so Devanagari digits count too.
_PHONE = re.compile(r"\d(?:[\s().+-]*\d){6,}")


class CompanionNameInvalid(ValueError):
    """Not a name we can keep: empty, too long, or contact details."""


def _tidy_name(value: str) -> str:
    return " ".join(_INVISIBLE.sub("", value).split())


def clean_name(value: str) -> str:
    """The one validation for a companion name: strip control / invisible characters,
    collapse whitespace, trim; then 1–24 characters, and no URL, email address or
    phone-number-like digit run. Returns the cleaned name or raises."""
    if len(value) > NAME_MAX * 8:  # no name needs this much; skip the regex work
        raise CompanionNameInvalid("length")
    name = _tidy_name(value)
    if not name or len(name) > NAME_MAX:
        raise CompanionNameInvalid("length")
    if _URL.search(name) or _EMAIL.search(name) or _PHONE.search(name):
        raise CompanionNameInvalid("contact")
    return name


def coerce_name(value: str | None) -> str | None:
    """Onboarding: never rejects (a person must always get in) — a name that fails the
    rules is simply not kept. The app validates the same rules before it sends one."""
    if value is None:
        return None
    try:
        return clean_name(value)
    except CompanionNameInvalid:
        return None
