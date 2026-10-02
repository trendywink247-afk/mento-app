"""Exclusive staging browser fixture. Never reset counters or erase existing chats.

Input JSON: {} to prepare; the returned snapshot to clean up. The receiver keeps
the snapshot private and restores it in the workflow's always() cleanup step.
"""
import json
import sys
import uuid

from sqlalchemy import select
from app.config import get_settings
from app.db import SessionLocal
from app.models.enums import Gender, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.security import issue_listener_token
from app.services import stream
from app.services.persona import generate_persona

if get_settings().env != "staging":
    raise SystemExit("Fixture is staging-only")
request = json.load(sys.stdin)
operation = request["operation"]
state = request.get("state", {})
with SessionLocal() as db:
    if operation == "plan":
        profiles = list(db.scalars(select(ListenerProfile)))
        print(json.dumps({"prior": {profile.id: profile.status.value for profile in profiles},
                          "id": str(uuid.uuid4())}))
    elif operation == "cleanup":
        for listener_id, status in state["prior"].items():
            profile = db.get(ListenerProfile, listener_id)
            if profile:
                profile.status = ListenerStatus(status)
        synthetic = db.get(ListenerProfile, state["id"])
        if synthetic:
            synthetic.status = ListenerStatus.offline
            synthetic.vetting_status = VettingStatus.suspended
        db.commit()
        print("{}")
    elif operation == "create":
        profiles = list(db.scalars(select(ListenerProfile).with_for_update()))
        if db.get(ListenerProfile, state["id"]):
            raise ValueError("Synthetic identity already exists")
        if {profile.id for profile in profiles} != set(state["prior"]):
            raise ValueError("Mentor pool changed after fixture plan")
        for profile in profiles:
            profile.status = ListenerStatus.away
        persona = generate_persona()
        synthetic = ListenerProfile(id=state["id"], persona_name=persona.name, persona_avatar=persona.avatar,
                                    gender=Gender.undisclosed, categories=["life", "loneliness"],
                                    community_slug=None, status=ListenerStatus.online,
                                    vetting_status=VettingStatus.approved, rank=10, max_concurrent=2)
        db.add(synthetic)
        db.flush()
        # If Stream setup fails, DB changes roll back together.
        stream.upsert_user(synthetic.id, synthetic.persona_name, synthetic.persona_avatar)
        token = issue_listener_token(synthetic.id)
        db.commit()
        print(json.dumps({"id": synthetic.id,
                          "url": "https://staging.mento.chat/listener#token=" + token}))
    else:
        raise ValueError("Unknown fixture operation")
