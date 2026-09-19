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
