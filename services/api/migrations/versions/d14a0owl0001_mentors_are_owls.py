"""mentors are owls: every mentor's face animal becomes the Owl (lane u14)

Founder, 2026-09-20: "the Owl is the default on the mentor side". Data only, no schema
change, safe under a running app. Every listener_profiles row gets companion_animal = 'Owl';
its companion_colour (the per-mentor wash that still tells mentors apart) is untouched, and
so is everything else. The app's insert hook deals new mentors the Owl too
(services/mentor_face.py).

Downgrade re-deals the animal each row had before, from a FROZEN copy of the old deal in
4b971bd4faaa (a migration must not import app code that may change later).

Revision ID: d14a0owl0001
Revises: 4b971bd4faaa
Create Date: 2026-09-20 12:00:00.000000
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d14a0owl0001"
down_revision: str | None = "4b971bd4faaa"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_ANIMALS = ("Owl", "Fox", "Deer", "Turtle", "Elephant", "Capybara", "Dog", "Panda", "Cat")

_listeners = sa.table(
    "listener_profiles",
    sa.column("id", sa.String),
    sa.column("companion_animal", sa.String),
)


def upgrade() -> None:
    op.get_bind().execute(_listeners.update().values(companion_animal="Owl"))


def downgrade() -> None:
    bind = op.get_bind()
    for listener_id in list(bind.execute(sa.select(_listeners.c.id)).scalars()):
        digest = hashlib.sha256(f"mento-mentor-face:{listener_id}".encode()).digest()
        animal = _OLD_ANIMALS[int.from_bytes(digest[:4], "big") % len(_OLD_ANIMALS)]
        bind.execute(
            _listeners.update()
            .where(_listeners.c.id == listener_id)
            .values(companion_animal=animal)
        )
