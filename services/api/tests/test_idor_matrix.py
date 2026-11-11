"""IDOR matrix: every route that takes an id in its path is attacked by someone who
does not own the thing behind that id.

How it works
- `app.openapi()` is the source of truth for which routes take a path id. Each one must be
  planned below (PLAN) or exempted with a reason (EXEMPT), so a NEW id route fails this
  test until somebody decides who may call it.
- Victims: member A, mentor M1, and the resources between them (a conversation, a
  personal request, a mentor link, a journal entry, a verification document).
- Attackers: member B, mentor M2 (both unrelated), the wrong role (a member on a mentor
  route, a mentor on a member route, a member/mentor on an admin route) and an anonymous
  caller.
- Every attack must come back 401/403/404. Admin routes must be 401/403 (the role gate
  runs before any lookup, so a random id cannot leak whether it exists). A 422 means the
  body was wrong and the attack proved nothing: fix BODIES, do not loosen the check.
- Afterwards the victims' rows must be exactly as they were.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models.conversation import Conversation
from app.models.enums import JournalChannel, LinkStatus, RequestStatus
from app.models.journal import JournalEntry
from app.models.listener import ListenerProfile
from app.models.mentor_document import MentorDocument
from app.models.mentor_link import MentorLink
from app.models.request import ConversationRequest
from app.security import issue_admin_token, issue_listener_token, issue_session_token
from app.services import stream

from .chat_helpers import seed_chat
from .conftest import TestSession, requires_postgres

API = "/api/v1"
METHODS = ("get", "post", "put", "patch", "delete")

# Who owns the id, which decides who the attackers are.
MEMBER = "member"  # a member's own thing (conversation, journal entry, link, request)
BOTH = "participants"  # readable/writable by the two people in the chat only
MENTOR = "mentor"  # a mentor's own thing (/listener/me/...)
ADMIN = "admin"  # admin console

PLAN: dict[tuple[str, str], str] = {}


def _plan(kind: str, *ops: str) -> None:
    for op in ops:
        method, path = op.split(" ", 1)
        PLAN[(method, f"{API}{path}")] = kind


_plan(
    ADMIN,
    "POST /admin/admins/{admin_id}/revoke",
    "POST /admin/applications/{app_id}/approve",
    "POST /admin/applications/{app_id}/decline",
    "GET /admin/conversations/{convo_id}/messages",
    "PATCH /admin/listeners/{listener_id}",
    "POST /admin/listeners/{listener_id}/certify",
    "POST /admin/listeners/{listener_id}/clear-line",
    "POST /admin/listeners/{listener_id}/console-link",
    "POST /admin/listeners/{listener_id}/reinstate",
    "POST /admin/listeners/{listener_id}/suspend",
    "POST /admin/mentor-invites/{invite_id}/revoke",
    "POST /admin/moderation/{event_id}/resolve",
    "POST /admin/safety/flags/{flag_id}/review",
    "POST /admin/verifications/{doc_id}/approve",
    "GET /admin/verifications/{doc_id}/file",
    "POST /admin/verifications/{doc_id}/reject",
)
_plan(
    BOTH,
    "GET /chat/{conversation_id}/messages",
    "POST /chat/{conversation_id}/wipe",
)
_plan(
    MEMBER,
    "GET /conversations/{convo_id}/allowance",
    "POST /conversations/{convo_id}/block",
    "POST /conversations/{convo_id}/end",
    "POST /conversations/{convo_id}/lock",
    "GET /conversations/{convo_id}/mentor",
    "POST /conversations/{convo_id}/pause",
    "POST /conversations/{convo_id}/reflection",
    "POST /conversations/{convo_id}/report",
    "GET /conversations/{convo_id}/state",
    "POST /conversations/{convo_id}/status-mask",
    "DELETE /conversations/{convo_id}/stay-in-touch",
    "GET /conversations/{convo_id}/stay-in-touch",
    "POST /conversations/{convo_id}/stay-in-touch",
    "POST /conversations/{convo_id}/unlock",
    "POST /conversations/{convo_id}/verify-pin",
    "POST /conversations/{convo_id}/wipe",
    "DELETE /in-touch/{link_id}",
    "DELETE /journals/entries/{entry_id}",
    "DELETE /listeners/requests/{request_id}",
)
_plan(
    MENTOR,
    "GET /listener/me/conversations/{convo_id}/brief",
    "POST /listener/me/conversations/{convo_id}/end",
    "POST /listener/me/conversations/{convo_id}/report",
    "DELETE /listener/me/conversations/{convo_id}/snooze",
    "POST /listener/me/conversations/{convo_id}/snooze",
    "DELETE /listener/me/conversations/{convo_id}/stay-in-touch",
    "POST /listener/me/conversations/{convo_id}/suggest-certified",
    "POST /listener/me/requests/{request_id}/accept",
    "POST /listener/me/requests/{request_id}/decline",
    "POST /listener/me/stay-in-touch/{link_id}/accept",
    "POST /listener/me/stay-in-touch/{link_id}/not-now",
    "POST /listeners/requests/{request_id}/accept",
    "POST /listeners/requests/{request_id}/decline",
)

# Not an IDOR surface, each with the reason. Review a new entry like a security change.
EXEMPT: dict[tuple[str, str], str] = {
    (
        "get",
        f"{API}/listeners/{{listener_id}}",
    ): "public mentor profile: the directory is public by design",
    (
        "post",
        f"{API}/listeners/{{listener_id}}/favourite",
    ): "acts on the caller's own favourites list",
    (
        "delete",
        f"{API}/listeners/{{listener_id}}/favourite",
    ): "acts on the caller's own favourites list",
    (
        "post",
        f"{API}/listeners/{{listener_id}}/request",
    ): "creates a request owned by the caller",
    (
        "post",
        f"{API}/listener/dev/token/{{listener_id}}",
    ): "404 unless ENV is dev; proved in test_listener_console.py",
}

# Bodies the handlers need before they reach the ownership check (a 422 proves nothing).
BODIES: dict[tuple[str, str], dict] = {
    ("post", "/admin/applications/{app_id}/decline"): {"reason": "no"},
    ("post", "/admin/listeners/{listener_id}/certify"): {"certified": True},
    ("post", "/admin/safety/flags/{flag_id}/review"): {"action": "no_action"},
    ("post", "/conversations/{convo_id}/block"): {},
    ("post", "/conversations/{convo_id}/report"): {},
    ("post", "/conversations/{convo_id}/status-mask"): {},
    ("post", "/conversations/{convo_id}/lock"): {"pin": "1234"},
    ("post", "/conversations/{convo_id}/pause"): {"paused": True},
    ("post", "/conversations/{convo_id}/reflection"): {"energy": 3},
    ("post", "/conversations/{convo_id}/unlock"): {"pin": "1234"},
    ("post", "/conversations/{convo_id}/verify-pin"): {"pin": "1234"},
    ("post", "/listener/me/conversations/{convo_id}/report"): {"reason": "other"},
}


@pytest.fixture(autouse=True)
def _stub_stream(monkeypatch):
    monkeypatch.setattr(
        stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id
    )
    monkeypatch.setattr(stream, "upsert_user", lambda *a, **k: None)
    monkeypatch.setattr(stream, "user_token", lambda user_id: f"stub::{user_id}")


def _operations() -> set[tuple[str, str]]:
    ops = set()
    for path, item in app.openapi()["paths"].items():
        if "{" not in path:
            continue
        for method in item:
            if method in METHODS:
                ops.add((method, path))
    return ops


def test_every_id_route_is_planned_or_exempt():
    """A new route with a path id must be added to PLAN (and attacked) or EXEMPT (with a reason)."""
    ops = _operations()
    planned = {(m.lower(), p) for (m, p) in PLAN}
    known = planned | set(EXEMPT)
    missing = sorted(ops - known)
    stale = sorted(known - ops)
    assert not missing, f"id routes with no IDOR plan: {missing}"
    assert not stale, f"planned routes that no longer exist: {stale}"
    assert not (planned & set(EXEMPT)), "a route is both planned and exempt"


class World:
    """Two member/mentor pairs plus one of each resource between pair A."""

    def __init__(self) -> None:
        with TestSession() as s:
            a = seed_chat(s)  # member A, mentor M1, their conversation
            b = seed_chat(s)  # member B, mentor M2: the unrelated pair
            now = datetime.now(UTC)
            request = ConversationRequest(
                requester_id=a.member_id,
                target_listener_id=a.mentor_id,
                intro_message="hi",
            )
            link = MentorLink(
                user_id=a.member_id,
                listener_id=a.mentor_id,
                conversation_id=a.cid,
                status=LinkStatus.pending,
                first_met_as="Open River",
                first_met_at=now,
            )
            entry = JournalEntry(
                user_id=a.member_id, channel=list(JournalChannel)[0], body="private"
            )
            doc = MentorDocument(
                listener_id=a.mentor_id,
                kind="id_card",
                content_type="image/png",
                size_bytes=3,
                content=b"abc",
            )
            s.add_all([request, link, entry, doc])
            s.commit()
            self.cid, self.rid, self.lid, self.eid, self.did = (
                a.cid,
                request.id,
                link.id,
                entry.id,
                doc.id,
            )
            self.member_a, self.mentor_1 = a.member_id, a.mentor_id
            self.member_b, self.mentor_2 = b.member_id, b.mentor_id
        self.tok = {
            "member_a": issue_session_token(self.member_a),
            "member_b": issue_session_token(self.member_b),
            "mentor_1": issue_listener_token(self.mentor_1),
            "mentor_2": issue_listener_token(self.mentor_2),
            # an id that is no admin: the admin gate must refuse before any lookup
            "fake_admin": issue_admin_token(str(uuid.uuid4())),
        }

    def fill(self, path: str) -> str:
        ids = {
            "convo_id": self.cid,
            "conversation_id": self.cid,
            "request_id": self.rid,
            "link_id": self.lid,
            "entry_id": self.eid,
            "doc_id": self.did,
            "listener_id": self.mentor_1,
        }
        out = path
        while "{" in out:
            start = out.index("{")
            name = out[start + 1 : out.index("}")]
            out = out.replace("{" + name + "}", ids.get(name) or str(uuid.uuid4()))
        return out

    def attackers(self, kind: str) -> dict[str, dict]:
        """name -> headers. The legitimate owner is never in the list."""

        def h(key: str) -> dict:
            return {"Authorization": f"Bearer {self.tok[key]}"}

        anon: dict = {}
        if kind == MEMBER:
            return {
                "member B (unrelated)": h("member_b"),
                "mentor M2 (wrong role)": h("mentor_2"),
                "mentor M1 (wrong role)": h("mentor_1"),
                "anonymous": anon,
            }
        if kind == BOTH:
            return {
                "member B (unrelated)": h("member_b"),
                "mentor M2 (unrelated)": h("mentor_2"),
                "anonymous": anon,
            }
        if kind == MENTOR:
            return {
                "mentor M2 (unrelated)": h("mentor_2"),
                "member A (wrong role)": h("member_a"),
                "member B (wrong role)": h("member_b"),
                "anonymous": anon,
            }
        return {  # ADMIN
            "member A": h("member_a"),
            "mentor M1": h("mentor_1"),
            "token for a non-admin id": h("fake_admin"),
            "anonymous": anon,
        }

    def snapshot(self) -> dict:
        with TestSession() as s:
            convo = s.get(Conversation, self.cid)
            request = s.get(ConversationRequest, self.rid)
            link = s.get(MentorLink, self.lid)
            doc = s.get(MentorDocument, self.did)
            mentor = s.get(ListenerProfile, self.mentor_1)
            return {
                "convo": (convo.status, convo.user_id, convo.listener_id),
                "request": (request.status, request.target_listener_id),
                "link": (link.status,),
                "entry": s.get(JournalEntry, self.eid) is not None,
                "doc": (doc.status, doc.content),
                "mentor": (mentor.status, mentor.vetting_status, mentor.certified_exam),
                "journal_count": len(s.execute(select(JournalEntry.id)).all()),
            }


@requires_postgres
def test_no_id_route_leaks_or_mutates_for_a_non_owner(db_session):
    client = TestClient(app, raise_server_exceptions=False)
    world = World()
    before = world.snapshot()
    failures: list[str] = []
    attacks = 0
    for (method, path), kind in sorted(PLAN.items()):
        body = BODIES.get((method.lower(), path.removeprefix(API)))
        url = world.fill(path)
        allowed = {401, 403} if kind == ADMIN else {401, 403, 404}
        for who, headers in world.attackers(kind).items():
            attacks += 1
            kwargs = {"json": body} if body is not None else {}
            resp = client.request(method, url, headers=headers, **kwargs)
            if resp.status_code not in allowed:
                failures.append(f"{method} {path} as {who}: {resp.status_code}")
    assert attacks >= 150, "the matrix shrank: check PLAN"
    assert not failures, "IDOR / role-gate failures:\n" + "\n".join(failures)
    assert world.snapshot() == before, "an attack changed a victim's data"


@requires_postgres
def test_the_owner_can_still_reach_their_own_resources(db_session):
    """Guard against a matrix that passes because everything is 404: the rightful owner gets through."""
    client = TestClient(app, raise_server_exceptions=False)
    world = World()
    member = {"Authorization": f"Bearer {world.tok['member_a']}"}
    mentor = {"Authorization": f"Bearer {world.tok['mentor_1']}"}
    assert client.get(f"{API}/conversations/{world.cid}/state", headers=member).status_code == 200
    assert client.get(f"{API}/chat/{world.cid}/messages", headers=member).status_code == 200
    assert client.get(f"{API}/chat/{world.cid}/messages", headers=mentor).status_code == 200
    assert (
        client.get(f"{API}/listener/me/conversations/{world.cid}/brief", headers=mentor).status_code
        == 200
    )
    assert client.delete(f"{API}/journals/entries/{world.eid}", headers=member).status_code in (
        200,
        204,
    )
    with TestSession() as s:
        assert s.get(JournalEntry, world.eid) is None
        assert s.get(ConversationRequest, world.rid).status == RequestStatus.pending
