"""Synthetic staging-only live Stream safety acceptance; never production."""

import time
import uuid
from sqlalchemy import func, select
from app.config import get_settings
from app.db import SessionLocal
from app.models.safety import SafetyFlag
from app.services import stream


def assert_current_crisis_helplines(payload):
    """Check the actual augmentation, including deployed environment overrides."""
    lines = payload.get("helplines", []) if isinstance(payload, dict) else []
    assert isinstance(lines, list), "crisis helpline list malformed"
    numbers = {
        "".join(char for char in str(line.get("number", "")) if char.isdigit())
        for line in lines
        if isinstance(line, dict)
    }
    assert {"14416", "18008914416"} <= numbers, "current Tele-MANAS numbers missing"
    assert "18005990019" not in numbers, "retired KIRAN number still configured"


assert get_settings().env == "staging"
client = stream._client()
user = str(uuid.uuid4())
channel_id = "staging-safety-" + uuid.uuid4().hex[:16]
client.upsert_user({"id": user, "name": "Synthetic safety check"})
channel = client.channel("messaging", channel_id, {"members": [user]})
channel.create(user)
try:
    benign = channel.send_message({"text": "Thank you for listening today"}, user)["message"]
    crisis = channel.send_message({"text": "honestly I want to die"}, user)["message"]
    assert not benign.get("crisis"), "benign message was flagged"
    assert crisis.get("crisis", {}).get("signal") == "suicidal", "crisis augmentation missing"
    assert_current_crisis_helplines(crisis.get("crisis"))
    time.sleep(4)
    with SessionLocal() as db:
        for msg, expected in [(benign, 0), (crisis, 1)]:
            count = db.scalar(
                select(func.count())
                .select_from(SafetyFlag)
                .where(SafetyFlag.stream_message_id == msg["id"])
            )
            assert count == expected, f"unexpected flag count: {count}"
    print(
        "PASS: live Stream bypass message augmented; one deduplicated crisis flag; benign zero flags"
    )
finally:
    channel.delete()
    client.delete_user(user, hard_delete=True)
