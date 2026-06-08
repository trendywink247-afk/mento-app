"""Seed a few approved, online listeners so General matching works locally.

Run from services/api:  python -m scripts.seed_listeners
"""
from __future__ import annotations

from app.db import SessionLocal, init_db
from app.models.enums import Gender, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.services.persona import generate_persona

SEED = [
    (Gender.female, ["loneliness", "self_esteem", "relationships"]),
    (Gender.male, ["focus", "studying", "family"]),
    (Gender.undisclosed, ["loneliness", "anxiety", "studying"]),
]


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        for gender, categories in SEED:
            persona = generate_persona()
            db.add(
                ListenerProfile(
                    persona_name=persona.name,
                    persona_avatar=persona.avatar,
                    gender=gender,
                    categories=categories,
                    status=ListenerStatus.online,
                    vetting_status=VettingStatus.approved,
                    rank=10,
                    max_concurrent=3,
                )
            )
        db.commit()
        print(f"Seeded {len(SEED)} listeners.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
