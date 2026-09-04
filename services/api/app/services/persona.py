"""Anonymous persona generation. Same generator for both sides of a conversation."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from app.services.personas_data import ADJECTIVES, AVATAR_SEEDS, NOUNS


@dataclass(frozen=True)
class Persona:
    name: str
    avatar: str


def generate_persona() -> Persona:
    """Return a fresh "[Adjective] [Noun]" persona + a scenic avatar seed.

    Uses `secrets` for unbiased selection. Collisions are acceptable (handles are
    not unique identifiers); the opaque user id remains the real key.
    """
    adjective = secrets.choice(ADJECTIVES)
    noun = secrets.choice(NOUNS)
    avatar = secrets.choice(AVATAR_SEEDS)
    return Persona(name=f"{adjective} {noun}", avatar=avatar)
