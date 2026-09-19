"""mentor face: one companion animal + wash colour per mentor (board port, lane u11)

Additive: two nullable columns on listener_profiles, backfilled, safe under a running app.
- listener_profiles.companion_animal / companion_colour — the ONE face every screen draws
  for a mentor (services/mentor_face.py). Dealt deterministically from the listener id;
  never rotates with the daily name (DECISIONS §L.6 l).

The backfill carries a FROZEN copy of `mentor_face.derive` (a migration must not import
app code that may change later): same salt, same order, so a row backfilled here and a row
dealt by the app's insert hook get the same face for the same id.

Revision ID: 4b971bd4faaa
Revises: 3a56447b2ab6
Create Date: 2026-09-19 23:30:00.000000
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "4b971bd4faaa"
down_revision: str | None = "3a56447b2ab6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ANIMALS = ("Owl", "Fox", "Deer", "Turtle", "Elephant", "Capybara", "Dog", "Panda", "Cat")
_COLOURS = ("sage", "mustard", "sky", "terracotta", "rose", "plum", "teal")


def _derive(listener_id: str) -> tuple[str, str]:
    digest = hashlib.sha256(f"mento-mentor-face:{listener_id}".encode()).digest()
    animal = _ANIMALS[int.from_bytes(digest[:4], "big") % len(_ANIMALS)]
    colour = _COLOURS[int.from_bytes(digest[4:8], "big") % len(_COLOURS)]
    return animal, colour


def upgrade() -> None:
    op.add_column(
        "listener_profiles", sa.Column("companion_animal", sa.String(length=32), nullable=True)
    )
    op.add_column(
        "listener_profiles", sa.Column("companion_colour", sa.String(length=32), nullable=True)
    )
    bind = op.get_bind()
    listeners = sa.table(
        "listener_profiles",
        sa.column("id", sa.String),
        sa.column("companion_animal", sa.String),
        sa.column("companion_colour", sa.String),
    )
    ids = bind.execute(
        sa.select(listeners.c.id).where(listeners.c.companion_animal.is_(None))
    ).scalars()
    for listener_id in list(ids):
        animal, colour = _derive(listener_id)
        bind.execute(
            listeners.update()
            .where(listeners.c.id == listener_id)
            .values(companion_animal=animal, companion_colour=colour)
        )


def downgrade() -> None:
    op.drop_column("listener_profiles", "companion_colour")
    op.drop_column("listener_profiles", "companion_animal")
