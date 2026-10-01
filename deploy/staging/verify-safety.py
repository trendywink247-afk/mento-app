"""Synthetic staging-only live Stream safety acceptance; never production."""

import time
import uuid
from sqlalchemy import func, select
from app.config import get_settings
from app.db import SessionLocal
from app.models.safety import SafetyFlag
from app.services import stream

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
