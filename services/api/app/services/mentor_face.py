"""One mentor, one face (board A06 / A10 / A14 / A25 / A35).

Every mentor is drawn as a companion animal standing in a soft round wash disc, on every
screen that shows them — the member's chat header, My Chats, Browse, the profile, the A04
letter, the connecting orb, and the mentor's own Mentor Home. The animal and the wash
colour live on `listener_profiles` (`companion_animal`, `companion_colour`) so the server
is the ONE source of truth; the client never derives a mentor's look on its own.

Rules
-----
- **Stable.** Assigned once — on insert (every creation path: admin approval, admin
  provisioning, seeds, tests) and by the backfill migration for older rows — and never
  touched by the daily name rotation ("same owl, new name", DECISIONS §L.6 l).
- **Deterministic from the listener id**, never from the persona name (it rotates) or the
  persona avatar (an approved mentor's avatar seed is copied from their member account,
  so deriving from it would tie the two identities together).
- **Carries nothing about a person.** It is a presentation choice made by the server,
  not the mentor's own member companion (that would link a dual-role person's two sides).

Editing it from the console is not built (not required yet); `derive` stays the fallback
for a row that somehow has none, so a payload never carries a null face.
"""

from __future__ import annotations

import hashlib
import uuid
from typing import TYPE_CHECKING

from app.services.companions import ANIMALS, COLOURS

if TYPE_CHECKING:
    from app.models.listener import ListenerProfile

# The board draws mentors mostly as owls on a sage wash (A06 / A10 / A14 / A25), with other
# mentors as other animals (A25's cards). Order is part of the contract: the backfill
# migration carries a frozen copy of these two tuples and of `derive`, so changing either
# would only re-deal NEW mentors — never an existing face.
FACE_ANIMALS: tuple[str, ...] = (
    "Owl",
    "Fox",
    "Deer",
    "Turtle",
    "Elephant",
    "Capybara",
    "Dog",
    "Panda",
    "Cat",
)
FACE_COLOURS: tuple[str, ...] = ("sage", "mustard", "sky", "terracotta", "rose", "plum", "teal")

DEFAULT_ANIMAL = "Owl"
DEFAULT_COLOUR = "sage"

assert set(FACE_ANIMALS) == set(ANIMALS), "a mentor face must be an animal the app can draw"
assert set(FACE_COLOURS) == set(COLOURS), "a mentor wash must be a companion colour"


def derive(listener_id: str) -> tuple[str, str]:
    """The face a listener id is dealt. Pure, stable across processes and releases."""
    digest = hashlib.sha256(f"mento-mentor-face:{listener_id}".encode()).digest()
    animal = FACE_ANIMALS[int.from_bytes(digest[:4], "big") % len(FACE_ANIMALS)]
    colour = FACE_COLOURS[int.from_bytes(digest[4:8], "big") % len(FACE_COLOURS)]
    return animal, colour


def assign(li: ListenerProfile) -> None:
    """Give a listener row its face if it has none (idempotent). Needs an id — the insert
    hook mints one first when the row has not been flushed yet."""
    if li.companion_animal and li.companion_colour:
        return
    if not li.id:
        li.id = str(uuid.uuid4())
    animal, colour = derive(li.id)
    li.companion_animal = li.companion_animal or animal
    li.companion_colour = li.companion_colour or colour


def face(li: ListenerProfile | None) -> tuple[str, str]:
    """(animal, colour) for a payload — never null. An unknown mentor (a deleted row)
    gets the board's default owl on sage."""
    if li is None:
        return DEFAULT_ANIMAL, DEFAULT_COLOUR
    if li.companion_animal and li.companion_colour:
        return li.companion_animal, li.companion_colour
    return derive(li.id)
