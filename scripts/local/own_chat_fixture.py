"""Create synthetic own-chat browser fixtures, only through the offline H launcher.

No public seeder endpoint, remote services, cleanup or real identities are used.
The private manifest is written under ignored .local, never printed or committed.
"""

import json
from datetime import date
from pathlib import Path

from sqlalchemy.engine import make_url

from app.config import get_settings
from app.db import SessionLocal
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_listener_token, issue_session_token


def main():
    settings = get_settings()
    url = make_url(settings.database_url)
    if (
        settings.env != "dev"
        or url.host != "127.0.0.1"
        or url.port != 15432
        or url.database != "mento_dev"
        or settings.stream_api_key
        or settings.stream_api_secret
    ):
        raise SystemExit(
            "Own-chat fixtures require isolated offline localhost development"
        )
    fixtures = []
    with SessionLocal() as db:
        for motion in ("normal", "reduced"):
            member = User(
                persona_name="Synthetic Cove",
                persona_avatar="test-cove",
                dob=date(1996, 1, 1),
                age_at_signup=30,
                companion_animal="Cat",
                companion_colour="sage",
            )
            mentor = ListenerProfile(
                persona_name="Synthetic River",
                persona_avatar="test-river",
                status=ListenerStatus.online,
                vetting_status=VettingStatus.approved,
                categories=[],
                active_conversations=1,
                max_concurrent=3,
                rank=0,
            )
            db.add_all([member, mentor])
            db.flush()
            room = Conversation(
                user_id=member.id,
                listener_id=mentor.id,
                chat_backend="own",
                status=ConversationStatus.active,
            )
            db.add(room)
            db.flush()
            room.stream_channel_id = room.id
            fixtures.append(
                {
                    "motion": motion,
                    "conversationId": room.id,
                    "member": {
                        "id": member.id,
                        "persona_name": member.persona_name,
                        "persona_avatar": member.persona_avatar,
                        "token": issue_session_token(member.id),
                    },
                    "mentor": {
                        "id": mentor.id,
                        "token": issue_listener_token(mentor.id),
                    },
                }
            )
        db.commit()
    root = Path(__file__).resolve().parents[2]
    target = root / ".local/own-chat-fixture.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(
        json.dumps(
            {
                "api": "http://localhost:18000/api/v1",
                "web": "http://localhost:18081",
                "fixtures": fixtures,
            }
        ),
        encoding="utf-8",
    )
    print("Synthetic own-chat fixtures saved under .local/own-chat-fixture.json")


if __name__ == "__main__":
    main()
