"""Seed a few approved, online listeners so General matching works locally.

Run from services/api:  python -m scripts.seed_listeners
"""
from __future__ import annotations

from app.db import SessionLocal, init_db
from app.models.enums import Gender, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.services import stream
from app.services.persona import generate_persona

# (gender, categories, community_slug) — community None = serves every path.
SEED = [
    (Gender.female, ["loneliness", "self_esteem", "relationships"], None),
    (Gender.male, ["focus", "studying", "family"], "upsc"),
    (Gender.undisclosed, ["loneliness", "anxiety", "studying"], "neet"),
]


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        for gender, categories, community in SEED:
            persona = generate_persona()
            db.add(
                ListenerProfile(
                    persona_name=persona.name,
                    persona_avatar=persona.avatar,
                    gender=gender,
                    categories=categories,
                    community_slug=community,
                    status=ListenerStatus.online,
                    vetting_status=VettingStatus.approved,
                    rank=10,
                    max_concurrent=3,
                )
            )
        db.commit()
        # Listeners must exist as Stream users before they can be channel members
        # (no-op in stub mode without creds). Done at seed, not on every match.
        listeners = db.query(ListenerProfile).all()
        for listener in listeners:
            stream.upsert_user(listener.id, listener.persona_name, listener.persona_avatar)
        print(f"Seeded {len(SEED)} listeners (upserted {len(listeners)} to Stream).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
