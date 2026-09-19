"""The companion's name (founder ruling 2026-09-19): set on the pick, read back only by
the member, never seen by a mentor, Stream, analytics or the admin dashboard.

Three parts: the one validation helper (services/companions.clean_name), the member's
own endpoints (onboarding start, PUT /me/companion, GET /me), and the privacy proof —
a member with a named companion walks through every flow that surfaces them to the
other side, then every mentor-facing and admin endpoint that returns member data is
called and its body searched for the name. Every Stream call is recorded and searched
too.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import inspect

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import AdminRole, ListenerStatus, VettingStatus
from app.models.listener import ListenerProfile
from app.models.user import User
from app.security import issue_admin_token, issue_listener_token, issue_session_token
from app.services import companions, stream

from .conftest import TestSession, requires_postgres, test_engine

API = "/api/v1"
ME = f"{API}/me"
COMPANION = f"{API}/me/companion"
# Unmistakable: if this string shows up in any payload, it came from users.companion_name.
NAME = "Quillon Zyxmiso"


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def stream_calls(monkeypatch):
    """Every Stream call the flows make, recorded (args and kwargs), never sent."""
    calls: list[str] = []

    def recorder(name, result):
        def _call(*args, **kwargs):
            calls.append(f"{name} {args!r} {kwargs!r}")
            return result(*args, **kwargs) if callable(result) else result

        return _call

    monkeypatch.setattr(stream, "upsert_user", recorder("upsert_user", None))
    monkeypatch.setattr(stream, "ensure_user", recorder("ensure_user", True))
    monkeypatch.setattr(stream, "rename_user", recorder("rename_user", True))
    monkeypatch.setattr(stream, "user_token", recorder("user_token", lambda uid: f"stub::{uid}"))
    monkeypatch.setattr(
        stream,
        "create_dm_channel",
        recorder("create_dm_channel", lambda channel_id, user_id, listener_id: channel_id),
    )
    monkeypatch.setattr(stream, "freeze_channel", recorder("freeze_channel", True))
    monkeypatch.setattr(stream, "wipe_channel", recorder("wipe_channel", None))
    monkeypatch.setattr(
        stream,
        "fetch_channel_messages",
        recorder("fetch_channel_messages", lambda channel_id: []),
    )
    monkeypatch.setattr(
        stream, "channel_last_message_at", recorder("channel_last_message_at", None)
    )
    return calls


def _user_auth(uid: str) -> dict:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def _listener_auth(lid: str) -> dict:
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


# --- the one validation helper ---------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "kept"),
    [
        ("Miso", "Miso"),
        ("  Miso  ", "Miso"),
        ("Mr   Whiskers", "Mr Whiskers"),
        ("Mi\x00so\x07", "Miso"),
        ("‮Miso", "Miso"),  # a right-to-left override cannot disguise the name
        ("Mi​so", "Miso"),  # zero-width space
        ("मिसो", "मिसो"),
        ("क्‍ष", "क्‍ष"),  # ZWJ is kept: Devanagari needs it
        ("Agent 007", "Agent 007"),
        ("Bao 2", "Bao 2"),
        ("x" * 24, "x" * 24),
        ("Dr. Paws", "Dr. Paws"),
    ],
)
def test_clean_name_keeps_names(raw, kept):
    assert companions.clean_name(raw) == kept


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "\x00\x01",
        "x" * 25,
        "x" * 500,
        "miso.com",
        "Visit Miso.in",
        "https://miso",
        "www.miso",
        "miso@example.com",
        "me@x.co",
        "9876543210",
        "+91 98765 43210",
        "987-654-3210",
        "(022) 2345 6789",
        "९८७६५४३२१०",  # Devanagari digits are digits
    ],
)
def test_clean_name_refuses_empty_long_and_contact_details(raw):
    with pytest.raises(companions.CompanionNameInvalid):
        companions.clean_name(raw)
    assert companions.coerce_name(raw) is None


# --- the migration ------------------------------------------------------------------


@requires_postgres
def test_migration_adds_one_nullable_24_char_column():
    columns = {c["name"]: c for c in inspect(test_engine).get_columns("users")}
    col = columns["companion_name"]
    assert col["nullable"] is True
    assert getattr(col["type"], "length", None) == companions.NAME_MAX


# --- the member's own endpoints -------------------------------------------------------


def _seed_user(s, **kwargs) -> str:
    u = User(
        persona_name="Gentle Harbor",
        persona_avatar="harbor",
        dob=date(1996, 1, 1),
        age_at_signup=30,
        **kwargs,
    )
    s.add(u)
    s.flush()
    return u.id


@requires_postgres
def test_onboarding_keeps_a_name_and_me_returns_it(client, db_session, stream_calls):
    r = client.post(
        f"{API}/onboarding/start",
        json={"dob": "1996-01-01", "companion_animal": "Cat", "companion_name": "  Miso "},
    )
    assert r.status_code == 201
    me = client.get(ME, headers={"Authorization": f"Bearer {r.json()['session_token']}"})
    assert me.json()["companion_name"] == "Miso"


@requires_postgres
def test_onboarding_never_refuses_a_bad_name_it_keeps_none(client, db_session, stream_calls):
    r = client.post(
        f"{API}/onboarding/start",
        json={"dob": "1996-01-01", "companion_name": "call 9876543210"},
    )
    assert r.status_code == 201
    with TestSession() as s:
        assert s.get(User, r.json()["user"]["id"]).companion_name is None


@requires_postgres
def test_put_sets_trims_leaves_alone_and_clears(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s, companion_animal="Cat", companion_colour="sage")
        s.commit()
    auth = _user_auth(uid)

    set_ = client.put(COMPANION, json={"companion_name": "  Miso  "}, headers=auth)
    assert set_.status_code == 200
    assert set_.json()["companion_name"] == "Miso"
    assert set_.json()["companion_animal"] == "Cat"  # omitted = unchanged

    recolour = client.put(COMPANION, json={"companion_colour": "plum"}, headers=auth)
    assert recolour.json()["companion_name"] == "Miso"  # omitted = unchanged

    assert client.get(ME, headers=auth).json()["companion_name"] == "Miso"

    cleared = client.put(COMPANION, json={"companion_name": None}, headers=auth)
    assert cleared.status_code == 200
    assert cleared.json()["companion_name"] is None
    with TestSession() as s:
        assert s.get(User, uid).companion_name is None


@requires_postgres
@pytest.mark.parametrize(
    "bad", ["miso@example.com", "www.miso.in", "+91 98765 43210", "   ", "x" * 25]
)
def test_put_refuses_a_bad_name_calmly_and_saves_nothing(client, db_session, bad):
    with TestSession() as s:
        uid = _seed_user(s, companion_animal="Cat", companion_colour="sage", companion_name="Miso")
        s.commit()
    r = client.put(
        COMPANION,
        json={"companion_name": bad, "companion_colour": "plum"},
        headers=_user_auth(uid),
    )
    assert r.status_code == 422
    assert r.json() == {
        "detail": companions.NAME_INVALID_DETAIL,
        "code": companions.NAME_INVALID_CODE,
    }
    with TestSession() as s:
        user = s.get(User, uid)
        # Nothing in the refused request was applied — not the name, not the colour.
        assert (user.companion_name, user.companion_colour) == ("Miso", "sage")


@requires_postgres
def test_an_oversized_body_is_still_refused(client, db_session):
    with TestSession() as s:
        uid = _seed_user(s)
        s.commit()
    r = client.put(COMPANION, json={"companion_name": "x" * 1000}, headers=_user_auth(uid))
    assert r.status_code == 422


# --- privacy: the name never reaches the other side ------------------------------------


def _seed_listener(s, name: str) -> str:
    li = ListenerProfile(
        persona_name=name,
        persona_avatar="river",
        categories=["loneliness"],
        status=ListenerStatus.online,
        vetting_status=VettingStatus.approved,
        rank=10,
        active_conversations=0,
        max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


APPLY = {
    "motivation": "I've walked the UPSC road twice and know how lonely the wait gets.",
    "communities": ["upsc"],
    "availability": "most_evenings",
    "email": None,
    "mentor_interest": False,
    "pledge_accepted": True,
}


def _assert_private(label: str, response) -> None:
    assert response.status_code < 500, f"{label}: {response.status_code} {response.text}"
    assert NAME not in response.text, f"{label} leaked the companion name"
    assert NAME.lower() not in response.text.lower(), f"{label} leaked the companion name"


@requires_postgres
def test_the_name_never_reaches_a_mentor_stream_or_an_admin(client, db_session, stream_calls):
    with TestSession() as s:
        first = _seed_listener(s, "Open River")
        second = _seed_listener(s, "Steady Cedar")
        admin = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(admin)
        s.commit()
        admin_auth = {"Authorization": f"Bearer {issue_admin_token(admin.id)}"}

    # The member arrives with a named companion and uses every flow that shows them to
    # the other side: a chat, a crisis flag, a stay-in-touch ask, a Personal request,
    # feedback, a mentor application and, last, a report.
    onboard = client.post(
        f"{API}/onboarding/start",
        json={
            "dob": "1996-01-01",
            "companion_animal": "Cat",
            "companion_colour": "sage",
            "companion_name": NAME,
        },
    )
    assert onboard.status_code == 201
    member_id = onboard.json()["user"]["id"]
    member = _user_auth(member_id)
    assert client.get(ME, headers=member).json()["companion_name"] == NAME  # stored

    match = client.post(f"{API}/match", json={"kind": "general"}, headers=member)
    assert match.status_code == 200, match.text
    convo_id = match.json()["conversation_id"]
    with TestSession() as s:
        matched = s.get(Conversation, convo_id).listener_id
    other = second if matched == first else first

    client.post(
        f"{API}/safety/scan",
        json={"text": "I want to die", "conversation_id": convo_id},
        headers=member,
    )
    client.post(f"{API}/conversations/{convo_id}/stay-in-touch", headers=member)
    request = client.post(
        f"{API}/listeners/{other}/request",
        json={"intro_message": "Could we talk this evening?"},
        headers=member,
    )
    assert request.status_code == 200, request.text
    client.post(
        f"{API}/feedback", json={"category": "idea", "text": "A calmer tab bar."}, headers=member
    )
    assert client.post(f"{API}/listener-applications", json=APPLY, headers=member).status_code in (
        200,
        201,
    )

    # --- every mentor-facing read that carries member data -------------------------
    for lid, auth in ((matched, _listener_auth(matched)), (other, _listener_auth(other))):
        for path in (
            "/listener/me",
            "/listener/me/conversations",
            "/listener/me/requests",
            "/listener/me/stay-in-touch",
        ):
            _assert_private(f"GET {path} ({lid})", client.get(f"{API}{path}", headers=auth))
    matched_auth = _listener_auth(matched)
    _assert_private(
        "GET brief",
        client.get(f"{API}/listener/me/conversations/{convo_id}/brief", headers=matched_auth),
    )
    other_auth = _listener_auth(other)
    pending = client.get(f"{API}/listener/me/requests", headers=other_auth).json()
    assert pending, "the Personal request should be in the second mentor's inbox"
    accepted = client.post(
        f"{API}/listener/me/requests/{pending[0]['id']}/accept", headers=other_auth
    )
    _assert_private("POST accept", accepted)
    for convo in client.get(f"{API}/listener/me/conversations", headers=other_auth).json():
        _assert_private(
            "GET brief (accepted)",
            client.get(f"{API}/listener/me/conversations/{convo['id']}/brief", headers=other_auth),
        )

    # The member reports the first chat — it lands in the moderation queue.
    client.post(
        f"{API}/conversations/{convo_id}/report",
        json={"reason": "other"},
        headers=member,
    )

    # --- every admin read that carries member data ---------------------------------
    for path in (
        "/admin/me",
        "/admin/overview",
        "/admin/safety/flags",
        f"/admin/conversations/{convo_id}/messages",
        "/admin/moderation/queue",
        "/admin/listeners",
        "/admin/applications",
        "/admin/health/deep",
        "/admin/allowance",
        "/admin/feedback",
        "/admin/contributions",
        "/admin/admins",
        "/admin/audit",
    ):
        _assert_private(f"GET {path}", client.get(f"{API}{path}", headers=admin_auth))
    applications = client.get(f"{API}/admin/applications", headers=admin_auth).json()
    assert applications, "the member's application should be in the queue"
    _assert_private(
        "POST approve",
        client.post(
            f"{API}/admin/applications/{applications[0]['id']}/approve", headers=admin_auth
        ),
    )

    # --- Stream only ever heard the persona ----------------------------------------
    assert stream_calls, "the flows above should have talked to Stream"
    leaked = [c for c in stream_calls if NAME in c]
    assert not leaked, f"Stream received the companion name: {leaked}"
