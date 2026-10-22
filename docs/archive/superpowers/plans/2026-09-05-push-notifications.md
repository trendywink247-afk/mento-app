# Push Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mentors and members receive conversation-event pushes (request created, request accepted, new message while away from the chat) with persona-only content, sent from the existing verified Stream webhook and request endpoints via Expo's push API — spec `docs/superpowers/specs/2026-09-05-push-notifications-design.md`.

**Architecture:** One new server module `services/push.py` owns token upsert/delete, suppression rules, the Expo HTTP send and receipt handling. Triggers are one-line calls from `routers/listeners.py` (request created), both accept paths (listener console + admin stand-in), and `routers/stream_hooks.py` (`message.new`, as a FastAPI `BackgroundTask` after the crisis scan, wrapped so it can never affect the scan). The `push_tokens` table learns who owns a token (`owner_kind` member/listener). On the app, `lib/pushNotifications.ts` registers for either role, and a new `lib/notifications.ts` installs the foreground handler and routes taps.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + `httpx` (already a dependency) + Redis (burst window, watcher cache) + Stream server SDK (`channel.query(watchers=…)`); Expo SDK 52 `expo-notifications`/`expo-device`, expo-router typed routes; pytest against Postgres; `npx tsc --noEmit`.

**Working directories:** server tasks in `services/api` (`./.venv/Scripts/python.exe -m …`, Postgres+Redis up, re-seed after pytest), mobile tasks in `apps/mobile`.

---

## File structure

| File | Responsibility |
|---|---|
| `app/models/enums.py` | `+ PushOwnerKind` |
| `app/models/push_token.py` | `+ owner_kind`, `+ owner_id` (index) |
| `migrations/versions/<rev>_push_token_owner.py` | columns + backfill from `user_id` |
| `app/config.py` | `push_enabled`, `push_burst_seconds`, `push_watch_cache_seconds` |
| `app/services/push.py` | NEW — upsert/delete, templates, suppression, `_is_watching`, `_send`, `notify_*` |
| `app/routers/notifications.py` | member register uses `upsert_token`; `+ DELETE /register-token` |
| `app/routers/listener_console.py` | `+ POST /listener/me/push-token`; accept → `notify_request_accepted` |
| `app/routers/listeners.py` | request create → `notify_request_created`; admin accept → `notify_request_accepted` |
| `app/routers/stream_hooks.py` | `push_webhook` schedules `notify_message_safe` |
| `app/schemas.py` | `+ PushTokenDeleteIn` |
| `scripts/send_test_push.py` | thin wrapper over `push._send` |
| `tests/test_push.py` | NEW — all §8 server tests |
| `tests/conftest.py` | autouse fixture turning push off + Expo recorder |
| `lib/pushNotifications.ts` | `registerPush(kind)`, `unregisterPush()` |
| `lib/notifications.ts` / `.web.ts` | handler install, `routeForNotification`, `useNotificationTaps` |
| `lib/api.ts`, `lib/listenerApi.ts` | `deletePushToken`, listener `registerPushToken` |
| `app/_layout.tsx`, `app/(tabs)/_layout.tsx`, `app/mentor-home.tsx`, `app/start-fresh.tsx` | wire-up |
| `e2e/notifications-route.test.mjs` | pure-function routing test (Node) |

---

### Task 1: Push-token ownership (enum, columns, migration, upsert helper)

**Files:**
- Modify: `app/models/enums.py`, `app/models/push_token.py`, `app/config.py`
- Create: `migrations/versions/<autogen>_push_token_owner.py`, `app/services/push.py` (first slice), `tests/test_push.py`
- Modify: `app/routers/notifications.py`, `tests/conftest.py`

- [ ] **Step 1: Enum + columns.** `app/models/enums.py` append:
```python
class PushOwnerKind(str, enum.Enum):
    member = "member"
    listener = "listener"
```
`app/models/push_token.py` — add `Index` to the sqlalchemy import, `PushOwnerKind` from enums, and change the class to:
```python
class PushToken(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "push_tokens"
    __table_args__ = (
        UniqueConstraint("expo_push_token", name="uq_push_token_value"),
        Index("ix_push_tokens_owner", "owner_kind", "owner_id"),
    )

    # Legacy column (member id) — kept one release for backfill; `owner_*` is the truth.
    user_id: Mapped[str] = mapped_column(String(36), index=True)
    # Who this device belongs to right now: a member (User id) or a listener
    # (ListenerProfile id). One physical device can flip between the two.
    owner_kind: Mapped[PushOwnerKind] = mapped_column(default=PushOwnerKind.member)
    owner_id: Mapped[str] = mapped_column(String(36))
    expo_push_token: Mapped[str] = mapped_column(String(255), index=True)
    platform: Mapped[str] = mapped_column(String(16))  # ios | android
```
`app/config.py` — next to `rate_limit_enabled` add:
```python
    # Push (spec 2026-09-05): best-effort sends via Expo's push API.
    push_enabled: bool = True
    push_burst_seconds: int = 60
    push_watch_cache_seconds: int = 5
```

- [ ] **Step 2: Migration.** `./.venv/Scripts/python.exe -m alembic revision --autogenerate -m "push token owner"`; make `upgrade()` read (match the repo's enum-creation style from `2788b34bd299_…`):
```python
def upgrade() -> None:
    owner_kind = sa.Enum("member", "listener", name="pushownerkind")
    owner_kind.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "push_tokens",
        sa.Column("owner_kind", owner_kind, nullable=False, server_default="member"),
    )
    op.add_column("push_tokens", sa.Column("owner_id", sa.String(length=36), nullable=True))
    op.execute("UPDATE push_tokens SET owner_id = user_id WHERE owner_id IS NULL")
    op.alter_column("push_tokens", "owner_id", nullable=False)
    op.create_index("ix_push_tokens_owner", "push_tokens", ["owner_kind", "owner_id"])


def downgrade() -> None:
    op.drop_index("ix_push_tokens_owner", table_name="push_tokens")
    op.drop_column("push_tokens", "owner_id")
    op.drop_column("push_tokens", "owner_kind")
    sa.Enum(name="pushownerkind").drop(op.get_bind(), checkfirst=True)
```
`alembic upgrade head` then `alembic check` → clean.

- [ ] **Step 3: Failing tests.** Create `tests/test_push.py`:
```python
"""Push notifications (spec 2026-09-05): token ownership, triggers, suppression, resilience."""

from __future__ import annotations

from datetime import date, datetime, UTC

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app import ratelimit
from app.main import app
from app.models.conversation import Conversation
from app.models.enums import ConversationStatus, ListenerStatus, PushOwnerKind, VettingStatus
from app.models.listener import ListenerProfile
from app.models.push_token import PushToken
from app.models.request import ConversationRequest
from app.models.user import User
from app.security import issue_listener_token, issue_session_token
from app.services import push, stream

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(
            text(
                "TRUNCATE users, listener_profiles, conversations, conversation_requests, "
                "push_tokens, safety_flags CASCADE"
            )
        )
        s.commit()
    yield


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id)
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stream-{uid}")


@pytest.fixture
def sent(monkeypatch):
    """Turn push ON for this test and record every Expo send instead of calling out."""
    calls: list[dict] = []

    def fake_post(messages: list[dict]) -> list[dict]:
        calls.extend(messages)
        return [{"status": "ok"} for _ in messages]

    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_post_expo", fake_post)
    monkeypatch.setattr(push, "_is_watching", lambda channel_id, user_id: False)
    return calls


@pytest.fixture
def client():
    return TestClient(app)


def _user(s, name="Quiet Cove") -> str:
    u = User(persona_name=name, persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, *, name="Open River", vetting=VettingStatus.approved, status=ListenerStatus.online) -> str:
    li = ListenerProfile(persona_name=name, persona_avatar="river", categories=["loneliness"], status=status,
                         vetting_status=vetting, rank=10, active_conversations=0, max_concurrent=3)
    s.add(li)
    s.flush()
    return li.id


def _token(s, kind: PushOwnerKind, owner_id: str, value: str) -> None:
    s.add(PushToken(user_id=owner_id, owner_kind=kind, owner_id=owner_id, expo_push_token=value, platform="android"))
    s.flush()


def _convo(s, user_id: str, listener_id: str, *, paused=False) -> str:
    c = Conversation(user_id=user_id, listener_id=listener_id, stream_channel_id=f"ch-{user_id[:8]}", is_paused=paused)
    s.add(c)
    s.flush()
    return c.id


def member_auth(uid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


def listener_auth(lid: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_listener_token(lid)}"}


# --- ownership ------------------------------------------------------------------


def test_member_register_sets_owner_member(client):
    with TestSession() as s:
        uid = _user(s)
        s.commit()
    r = client.post("/api/v1/notifications/register-token",
                    json={"expo_push_token": "ExponentPushToken[m1]", "platform": "android"}, headers=member_auth(uid))
    assert r.status_code == 200
    with TestSession() as s:
        row = s.scalars(select(PushToken)).one()
        assert row.owner_kind == PushOwnerKind.member and row.owner_id == uid and row.user_id == uid


def test_listener_register_sets_owner_listener_and_repoints_a_member_token(client):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        s.commit()
    tok = "ExponentPushToken[one-device]"
    client.post("/api/v1/notifications/register-token", json={"expo_push_token": tok, "platform": "android"}, headers=member_auth(uid))
    r = client.post("/api/v1/listener/me/push-token", json={"expo_push_token": tok, "platform": "android"}, headers=listener_auth(lid))
    assert r.status_code == 200 and r.json()["status"] == "registered"
    with TestSession() as s:
        rows = s.scalars(select(PushToken)).all()
        assert len(rows) == 1
        assert rows[0].owner_kind == PushOwnerKind.listener and rows[0].owner_id == lid


def test_listener_register_refused_when_suspended(client):
    with TestSession() as s:
        lid = _listener(s, vetting=VettingStatus.suspended)
        s.commit()
    r = client.post("/api/v1/listener/me/push-token", json={"expo_push_token": "ExponentPushToken[x]", "platform": "android"}, headers=listener_auth(lid))
    assert r.status_code == 403


def test_member_delete_removes_only_own_token(client):
    with TestSession() as s:
        a, b = _user(s), _user(s, "Still Pine")
        _token(s, PushOwnerKind.member, a, "ExponentPushToken[a]")
        _token(s, PushOwnerKind.member, b, "ExponentPushToken[b]")
        s.commit()
    r = client.request("DELETE", "/api/v1/notifications/register-token", json={"expo_push_token": "ExponentPushToken[b]"}, headers=member_auth(a))
    assert r.status_code == 200 and r.json()["status"] == "ok"
    r = client.request("DELETE", "/api/v1/notifications/register-token", json={"expo_push_token": "ExponentPushToken[a]"}, headers=member_auth(a))
    assert r.status_code == 200
    with TestSession() as s:
        assert [t.expo_push_token for t in s.scalars(select(PushToken)).all()] == ["ExponentPushToken[b]"]
```

- [ ] **Step 4: Run** `-m pytest tests/test_push.py -q` → FAIL (`push` module / endpoints missing).

- [ ] **Step 5: `app/services/push.py` (first slice — tokens only):**
```python
"""Push notifications (spec 2026-09-05-push-notifications-design.md).

Best-effort, never blocking: a push failure can never delay or degrade a
conversation, the crisis scan, or a request. Content is persona-only — no
message text ever leaves the chat path. Sends go to Expo's push API (FCM/APNs
relay) over httpx.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models.enums import PushOwnerKind
from app.models.push_token import PushToken

logger = logging.getLogger("mento.push")

# Test hook (like ratelimit.ENABLED): conftest forces False; push tests flip it True.
ENABLED: bool | None = None


def _enabled() -> bool:
    return ENABLED if ENABLED is not None else get_settings().push_enabled


def upsert_token(db: Session, kind: PushOwnerKind, owner_id: str, token: str, platform: str) -> None:
    """One row per device token: re-point on reinstall or role flip, never duplicate."""
    existing = db.scalars(select(PushToken).where(PushToken.expo_push_token == token).limit(1)).first()
    if existing is not None:
        existing.owner_kind = kind
        existing.owner_id = owner_id
        existing.platform = platform
        if kind == PushOwnerKind.member:
            existing.user_id = owner_id
    else:
        db.add(
            PushToken(
                user_id=owner_id,
                owner_kind=kind,
                owner_id=owner_id,
                expo_push_token=token,
                platform=platform,
            )
        )
    db.commit()


def delete_token(db: Session, kind: PushOwnerKind, owner_id: str, token: str) -> None:
    """Remove a device token, but only if the caller owns it (opaque no-op otherwise)."""
    row = db.scalars(
        select(PushToken).where(
            PushToken.expo_push_token == token,
            PushToken.owner_kind == kind,
            PushToken.owner_id == owner_id,
        )
    ).first()
    if row is not None:
        db.delete(row)
        db.commit()


def tokens_for(db: Session, kind: PushOwnerKind, owner_id: str) -> list[str]:
    return list(
        db.scalars(
            select(PushToken.expo_push_token).where(
                PushToken.owner_kind == kind, PushToken.owner_id == owner_id
            )
        ).all()
    )
```

- [ ] **Step 6: Endpoints.** `app/schemas.py` after `PushTokenIn`:
```python
class PushTokenDeleteIn(BaseModel):
    expo_push_token: str = Field(min_length=1, max_length=255)
```
`app/routers/notifications.py` — replace the body of `register_token` after the rate limit with `push.upsert_token(db, PushOwnerKind.member, user_id, payload.expo_push_token, payload.platform)` and `return {"status": "registered"}` (imports: `from app.models.enums import PushOwnerKind`, `from app.services import push`, `PushTokenDeleteIn`); remove the now-unused `select`/`PushToken` imports if unused; append:
```python
@router.delete("/register-token", response_model=dict)
def delete_token(
    payload: PushTokenDeleteIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> dict:
    """Start Fresh calls this before wiping the session so the old persona's device
    stops receiving anything. Only the owner can remove a token."""
    push.delete_token(db, PushOwnerKind.member, user_id, payload.expo_push_token)
    return {"status": "ok"}
```
`app/routers/listener_console.py` — imports `PushTokenIn` (schemas), `PushOwnerKind` (enums), `from app.services import push`; append:
```python
@router.post("/me/push-token", response_model=dict)
def register_push_token(
    payload: PushTokenIn,
    listener: ListenerProfile = Depends(current_listener),
    db: Session = Depends(get_db),
) -> dict:
    """Mentor device registration (spec 2026-09-05 push §3). Same upsert as the
    member path; `current_listener` already refuses suspended profiles."""
    ratelimit.enforce(f"push-token-listener:{listener.id}", 20, 3600, detail="Too many token registrations — please wait a moment.")
    push.upsert_token(db, PushOwnerKind.listener, listener.id, payload.expo_push_token, payload.platform)
    return {"status": "registered"}
```

- [ ] **Step 7: conftest.** In `tests/conftest.py` add next to `_rate_limits_off`:
```python
@pytest.fixture(autouse=True)
def _push_off():
    """Push is off by default in tests (no network); tests/test_push.py flips it on
    per test and records sends."""
    from app.services import push

    previous = push.ENABLED
    push.ENABLED = False
    yield
    push.ENABLED = previous
```

- [ ] **Step 8: Verify + commit.** `-m pytest tests/test_push.py tests/test_notifications.py -q` → PASS (the old notifications tests still assert `user_id`, which the member upsert keeps). Full `-m pytest -q`, `-m alembic check`, `-m ruff check app tests`, `-m black --check app tests`. Re-seed.
```bash
git add app/models app/config.py app/services/push.py app/schemas.py app/routers/notifications.py app/routers/listener_console.py migrations/versions tests/test_push.py tests/conftest.py
git commit -m "feat(api): push tokens know their owner (member/listener); listener registration; member delete; push service skeleton" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Send path — templates, suppression, Expo HTTP, receipts

**Files:**
- Modify: `app/services/push.py`, `tests/test_push.py`

- [ ] **Step 1: Failing tests** — append to `tests/test_push.py`:
```python
# --- send path -------------------------------------------------------------------


def _seed_pair(s, *, token_kind: PushOwnerKind, paused=False):
    uid, lid = _user(s, "Quiet Cove"), _listener(s, name="Open River")
    cid = _convo(s, uid, lid, paused=paused)
    if token_kind == PushOwnerKind.member:
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
    else:
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
    s.commit()
    return uid, lid, cid


def test_member_message_pushes_the_listener_with_member_persona(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    assert len(sent) == 1
    msg = sent[0]
    assert msg["to"] == "ExponentPushToken[listener]"
    assert msg["title"] == "Mento" and msg["body"] == "Quiet Cove sent a message"
    assert msg["sound"] is None
    assert msg["data"] == {"kind": "message", "conversation_id": cid, "stream_channel_id": f"ch-{uid[:8]}"}
    assert "text" not in msg["data"]


def test_listener_message_pushes_the_member_with_listener_persona(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.member)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=lid)
    assert len(sent) == 1 and sent[0]["body"] == "Open River replied"


@pytest.mark.parametrize("reason", ["no_token", "suspended", "ended", "watching", "paused", "burst"])
def test_message_suppression_rules(sent, monkeypatch, reason):
    with TestSession() as s:
        uid, lid = _user(s, "Quiet Cove"), _listener(s, name="Open River")
        cid = _convo(s, uid, lid, paused=(reason == "paused"))
        if reason != "no_token":
            _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
            _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
        if reason == "suspended":
            s.get(ListenerProfile, lid).vetting_status = VettingStatus.suspended
        if reason == "ended":
            s.get(Conversation, cid).status = ConversationStatus.ended
        s.commit()
    if reason == "watching":
        monkeypatch.setattr(push, "_is_watching", lambda channel_id, user_id: True)
    sender = lid if reason == "paused" else uid  # paused: the LISTENER writes, member must not be pushed
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=sender)
        if reason == "burst":
            push.notify_message(s, conversation_id=cid, sender_stream_user_id=sender)
    if reason == "burst":
        assert len(sent) == 1
    else:
        assert sent == []


def test_burst_window_resets(sent, monkeypatch):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
        ratelimit._redis().delete(*ratelimit._redis().keys("push:burst:*") or ["push:burst:none"])
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    assert len(sent) == 2


def test_self_echo_never_pushes_and_unknown_channel_is_ignored(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id="someone-else")
        push.notify_message(s, conversation_id="nope", sender_stream_user_id=uid)
    assert sent == []


def test_accepted_pushes_member_even_when_paused(sent):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.member, paused=True)
        req = ConversationRequest(requester_id=uid, target_listener_id=lid, conversation_id=cid)
        s.add(req)
        s.commit()
        rid = req.id
    with TestSession() as s:
        push.notify_request_accepted(s, request_id=rid)
    assert len(sent) == 1
    assert sent[0]["body"] == "Open River is ready to talk"
    assert sent[0]["data"]["kind"] == "accepted" and sent[0]["data"]["conversation_id"] == cid


def test_request_created_pushes_listener_without_requester_persona(sent):
    with TestSession() as s:
        uid, lid = _user(s, "Quiet Cove"), _listener(s)
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
        req = ConversationRequest(requester_id=uid, target_listener_id=lid)
        s.add(req)
        s.commit()
        rid = req.id
    with TestSession() as s:
        push.notify_request_created(s, request_id=rid)
    assert len(sent) == 1
    assert sent[0]["body"] == "Someone would like to talk with you"
    assert "Quiet Cove" not in sent[0]["body"]
    assert sent[0]["data"] == {"kind": "request", "request_id": rid}


def test_device_not_registered_deletes_token(monkeypatch):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_is_watching", lambda c, u: False)
    monkeypatch.setattr(push, "_post_expo", lambda msgs: [{"status": "error", "details": {"error": "DeviceNotRegistered"}} for _ in msgs])
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)
    with TestSession() as s:
        assert s.scalars(select(PushToken)).all() == []


def test_network_error_retried_once_then_dropped(monkeypatch):
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    attempts = {"n": 0}

    def flaky(msgs):
        attempts["n"] += 1
        raise push.httpx.ConnectError("boom")

    monkeypatch.setattr(push, "ENABLED", True)
    monkeypatch.setattr(push, "_is_watching", lambda c, u: False)
    monkeypatch.setattr(push, "_post_expo", flaky)
    monkeypatch.setattr(push.time, "sleep", lambda s: None)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)  # must not raise
    assert attempts["n"] == 2


def test_disabled_sends_nothing(monkeypatch):
    calls = []
    monkeypatch.setattr(push, "_post_expo", lambda m: calls.extend(m) or [])
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
    with TestSession() as s:
        push.notify_message(s, conversation_id=cid, sender_stream_user_id=uid)  # ENABLED is False via conftest
    assert calls == []
```

- [ ] **Step 2: Run** → FAIL (`notify_message` missing).

- [ ] **Step 3: Implement** — extend `app/services/push.py` (keep Task 1's content; add imports `import time`, `import httpx`, `from app import ratelimit`, `from app.models.conversation import Conversation`, `from app.models.enums import ConversationStatus, VettingStatus`, `from app.models.listener import ListenerProfile`, `from app.models.request import ConversationRequest`, `from app.models.user import User`, `from app.services import stream`):
```python
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
TITLE = "Mento"

# Closed template set — no free text ever enters a push (spec §5).
TEMPLATES = {
    "request": "Someone would like to talk with you",
    "accepted": "%(persona)s is ready to talk",
    "message_from_member": "%(persona)s sent a message",
    "message_from_listener": "%(persona)s replied",
}


def _is_watching(channel_id: str, user_id: str) -> bool:
    """True when `user_id` is currently watching the Stream channel (chat screen open).
    Cached briefly in Redis per channel; on any error assume NOT watching (send)."""
    key = f"push:watchers:{channel_id}"
    try:
        r = ratelimit._redis()
        cached = r.get(key)
        if cached is not None:
            return user_id in cached.split(",")
    except Exception:
        pass
    client = stream._client()
    if client is None:
        return False
    try:
        resp = client.channel("messaging", channel_id).query(watchers={"limit": 100}, state=False, presence=False)
        watchers = [w.get("id") for w in (resp.get("watchers") or []) if w.get("id")]
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("watcher query failed (%s) — treating as not watching", type(exc).__name__)
        return False
    try:
        ratelimit._redis().set(key, ",".join(watchers), ex=get_settings().push_watch_cache_seconds)
    except Exception:
        pass
    return user_id in watchers


def _burst_open(conversation_id: str, recipient_id: str) -> bool:
    """One message push per recipient per conversation per window. Redis SET NX;
    on Redis error allow the send (fail open, like the rate limiter)."""
    try:
        return bool(
            ratelimit._redis().set(
                f"push:burst:{conversation_id}:{recipient_id}", "1", nx=True, ex=get_settings().push_burst_seconds
            )
        )
    except Exception:
        return True


def _post_expo(messages: list[dict]) -> list[dict]:
    """POST a batch to Expo. Returns the per-message ticket list. Raises on transport errors."""
    resp = httpx.post(
        EXPO_PUSH_URL,
        json=messages,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        timeout=10.0,
    )
    resp.raise_for_status()
    return list((resp.json() or {}).get("data") or [])


def _send(db: Session, tokens: list[str], body: str, data: dict) -> None:
    if not tokens or not _enabled():
        return
    messages = [{"to": t, "title": TITLE, "body": body, "sound": None, "data": data} for t in tokens]
    tickets: list[dict] = []
    for attempt in (1, 2):
        try:
            tickets = _post_expo(messages)
            break
        except (httpx.HTTPError, ValueError) as exc:
            logger.warning("push send failed (attempt %d): %s", attempt, type(exc).__name__)
            if attempt == 1:
                time.sleep(1.0)
    dead = [
        t
        for t, ticket in zip(tokens, tickets)
        if ticket.get("status") == "error" and (ticket.get("details") or {}).get("error") == "DeviceNotRegistered"
    ]
    if dead:
        for row in db.scalars(select(PushToken).where(PushToken.expo_push_token.in_(dead))).all():
            db.delete(row)
        db.commit()
    logger.info("push sent=%d dead=%d", len(tickets), len(dead))


def _listener_ok(db: Session, listener_id: str) -> bool:
    li = db.get(ListenerProfile, listener_id)
    return li is not None and li.vetting_status == VettingStatus.approved


def notify_message(db: Session, *, conversation_id: str, sender_stream_user_id: str) -> None:
    """message.new → push the OTHER party unless suppressed (spec §4)."""
    convo = db.get(Conversation, conversation_id)
    if convo is None or convo.status != ConversationStatus.active or not convo.stream_channel_id:
        return
    if sender_stream_user_id == convo.user_id:
        recipient_kind, recipient_id = PushOwnerKind.listener, convo.listener_id
        persona = db.get(User, convo.user_id)
        body = TEMPLATES["message_from_member"] % {"persona": persona.persona_name if persona else "Someone"}
    elif sender_stream_user_id == convo.listener_id:
        recipient_kind, recipient_id = PushOwnerKind.member, convo.user_id
        li = db.get(ListenerProfile, convo.listener_id)
        body = TEMPLATES["message_from_listener"] % {"persona": li.persona_name if li else "Your mentor"}
    else:
        return  # not a party to this conversation
    tokens = tokens_for(db, recipient_kind, recipient_id)
    if not tokens:
        return
    if recipient_kind == PushOwnerKind.listener and not _listener_ok(db, recipient_id):
        return
    if recipient_kind == PushOwnerKind.member and convo.is_paused:
        return
    if _is_watching(convo.stream_channel_id, recipient_id):
        return
    if not _burst_open(convo.id, recipient_id):
        return
    _send(db, tokens, body, {"kind": "message", "conversation_id": convo.id, "stream_channel_id": convo.stream_channel_id})


def notify_request_created(db: Session, *, request_id: str) -> None:
    req = db.get(ConversationRequest, request_id)
    if req is None or not req.target_listener_id or not _listener_ok(db, req.target_listener_id):
        return
    tokens = tokens_for(db, PushOwnerKind.listener, req.target_listener_id)
    _send(db, tokens, TEMPLATES["request"], {"kind": "request", "request_id": req.id})


def notify_request_accepted(db: Session, *, request_id: str) -> None:
    req = db.get(ConversationRequest, request_id)
    if req is None or not req.conversation_id:
        return
    convo = db.get(Conversation, req.conversation_id)
    li = db.get(ListenerProfile, req.target_listener_id) if req.target_listener_id else None
    if convo is None or li is None:
        return
    tokens = tokens_for(db, PushOwnerKind.member, req.requester_id)
    _send(
        db,
        tokens,
        TEMPLATES["accepted"] % {"persona": li.persona_name},
        {"kind": "accepted", "conversation_id": convo.id, "stream_channel_id": convo.stream_channel_id},
    )


def notify_message_safe(conversation_lookup_channel_id: str, sender_stream_user_id: str) -> None:
    """BackgroundTask entry (own session): resolve channel → conversation, then notify.
    Everything is caught — a push failure must never surface to the webhook."""
    from app.db import SessionLocal

    try:
        with SessionLocal() as db:
            cid = db.execute(
                select(Conversation.id).where(Conversation.stream_channel_id == conversation_lookup_channel_id)
            ).scalar_one_or_none()
            if cid:
                notify_message(db, conversation_id=cid, sender_stream_user_id=sender_stream_user_id)
    except Exception as exc:  # noqa: BLE001 — best-effort by design
        logger.warning("push background task failed: %s", type(exc).__name__)
```
Check the Stream SDK signature: `channel.query(**options)` in `stream_chat/base/channel.py` accepts `watchers`, `state`, `presence` keys; the response is a dict-like `StreamResponse` — `resp.get("watchers")` works. If the SDK requires `client.channel(type, id)` positional args differently, adapt and note it.

- [ ] **Step 4: Run** `-m pytest tests/test_push.py -q` → PASS. Full suite, ruff, black.

- [ ] **Step 5: Commit**
```bash
git add app/services/push.py tests/test_push.py
git commit -m "feat(api): push send path — persona-only templates, suppression rules, Expo HTTP with retry + dead-token cleanup" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Wire the triggers (request create, both accepts, message.new webhook)

**Files:**
- Modify: `app/routers/listeners.py`, `app/routers/listener_console.py`, `app/routers/stream_hooks.py`, `scripts/send_test_push.py`, `tests/test_push.py`

- [ ] **Step 1: Failing tests** — append:
```python
# --- triggers --------------------------------------------------------------------


def test_create_request_endpoint_pushes_target_listener(client, sent):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        _token(s, PushOwnerKind.listener, lid, "ExponentPushToken[listener]")
        s.commit()
    r = client.post(f"/api/v1/listeners/{lid}/request", json={"intro_message": "hi", "issue_category": None}, headers=member_auth(uid))
    assert r.status_code == 200, r.text
    assert len(sent) == 1 and sent[0]["data"]["kind"] == "request"
    # Idempotent re-post (existing pending) must NOT push again.
    client.post(f"/api/v1/listeners/{lid}/request", json={"intro_message": "hi", "issue_category": None}, headers=member_auth(uid))
    assert len(sent) == 1


def test_console_accept_pushes_requester(client, sent):
    with TestSession() as s:
        uid, lid = _user(s), _listener(s)
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
        req = ConversationRequest(requester_id=uid, target_listener_id=lid)
        s.add(req)
        s.commit()
        rid = req.id
    r = client.post(f"/api/v1/listener/me/requests/{rid}/accept", headers=listener_auth(lid))
    assert r.status_code == 200, r.text
    assert len(sent) == 1 and sent[0]["data"]["kind"] == "accepted"


def test_admin_accept_pushes_requester(client, sent):
    from app.models.admin import AdminAccount
    from app.models.enums import AdminRole
    from app.security import issue_admin_token

    with TestSession() as s:
        s.execute(text("TRUNCATE admin_accounts, admin_audit_log CASCADE"))
        a = AdminAccount(name="Founder", role=AdminRole.owner)
        s.add(a)
        s.flush()
        admin_id = a.id
        uid, lid = _user(s), _listener(s)
        _token(s, PushOwnerKind.member, uid, "ExponentPushToken[member]")
        req = ConversationRequest(requester_id=uid, target_listener_id=lid)
        s.add(req)
        s.commit()
        rid = req.id
    r = client.post(f"/api/v1/listeners/requests/{rid}/accept", headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"})
    assert r.status_code == 200, r.text
    assert len(sent) == 1 and sent[0]["data"]["kind"] == "accepted"


def test_message_new_webhook_schedules_push_and_never_depends_on_it(client, sent, monkeypatch):
    """The async webhook pushes the other party; a push failure changes neither the 200 nor the scan."""
    from app.routers import stream_hooks

    monkeypatch.setattr(stream, "verify_webhook", lambda body, sig: True)
    with TestSession() as s:
        uid, lid, cid = _seed_pair(s, token_kind=PushOwnerKind.listener)
        channel = s.get(Conversation, cid).stream_channel_id
    event = {"type": "message.new", "message": {"id": "m1", "text": "hello", "user": {"id": uid}}, "channel": {"id": channel}}
    r = client.post("/api/v1/stream/webhook", json=event)
    assert r.status_code == 200
    assert len(sent) == 1 and sent[0]["body"] == "Quiet Cove sent a message"

    def explode(*a, **k):
        raise RuntimeError("push exploded")

    monkeypatch.setattr(stream_hooks.push, "notify_message", explode)
    r = client.post("/api/v1/stream/webhook", json={**event, "message": {**event["message"], "id": "m2"}})
    assert r.status_code == 200
```
(Look at `tests/test_stream_webhook.py` for how the existing suite disables signature checks and whether the `SafetyFlag` write is asserted; mirror its setup if `verify_webhook` is patched differently there.)

- [ ] **Step 2: Run** → FAIL (no sends from endpoints).

- [ ] **Step 3: Wire.**
`app/routers/listeners.py`: `from app.services import push`; in `create_personal_request` after `db.refresh(req)` add `push.notify_request_created(db, request_id=req.id)` (NOT on the idempotent early return); in `accept_request` after `db.commit()` add `push.notify_request_accepted(db, request_id=request_id)`.
`app/routers/listener_console.py`: in `accept` after the try/except succeeds (before `return RequestOut(...)`) add `push.notify_request_accepted(db, request_id=req.id)`.
`app/routers/stream_hooks.py`: `from fastapi import BackgroundTasks` (add to the existing fastapi import) and `from app.services import push`; change `push_webhook` to:
```python
@router.post("/webhook")
async def push_webhook(request: Request, background: BackgroundTasks) -> Response:
    """Async safety net: re-scan message.new events (retried by Stream on recovery),
    then schedule the push to the other party (best-effort, after the scan)."""
    event = await _verified_event(request)
    if event.get("type") == "message.new":
        message = event.get("message") or {}
        channel_id = (event.get("channel") or {}).get("id") or event.get("channel_id")
        sender_id = (message.get("user") or {}).get("id") or "unknown"
        await _run_scan(
            text=message.get("text") or "",
            user_id=sender_id,
            channel_id=channel_id,
            message_id=message.get("id"),
        )
        if channel_id:
            background.add_task(push.notify_message_safe, channel_id, sender_id)
    return Response(status_code=status.HTTP_200_OK)
```
For the "never depends on it" test to see a *synchronous* failure path, `notify_message_safe` must catch everything (it does). Note: FastAPI runs background tasks after the response; `TestClient` executes them before returning, so `sent` is populated synchronously in tests.
`scripts/send_test_push.py`: replace the `httpx.post(...)` block with `from app.services import push` + `push._send(db, [token], args.body, {"kind": "test"})` inside a `SessionLocal()` session (set `push.ENABLED = True` first) and print "sent".

- [ ] **Step 4: Verify.** `-m pytest tests/test_push.py tests/test_stream_webhook.py tests/test_listeners.py tests/test_listener_console.py -q` → PASS; full suite; alembic check; ruff; black; re-seed.

- [ ] **Step 5: Commit**
```bash
git add app/routers/listeners.py app/routers/listener_console.py app/routers/stream_hooks.py scripts/send_test_push.py tests/test_push.py
git commit -m "feat(api): push triggers — request created, request accepted (console + admin), message.new background push after the crisis scan" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Mobile — registration for both roles, delete on Start Fresh

**Files:**
- Modify: `lib/pushNotifications.ts`, `lib/api.ts`, `lib/listenerApi.ts`, `app/(tabs)/_layout.tsx`, `app/mentor-home.tsx`, `app/start-fresh.tsx`

- [ ] **Step 1: Clients.** `lib/api.ts` in the `api` object after `registerPushToken`:
```ts
  deletePushToken: (expo_push_token: string) =>
    request<{ status: string }>('/notifications/register-token', { method: 'DELETE', body: JSON.stringify({ expo_push_token }) }, true),
```
`lib/listenerApi.ts` in `listenerApi`:
```ts
  registerPushToken: (expo_push_token: string, platform: 'ios' | 'android') =>
    req<{ status: string }>('/listener/me/push-token', { method: 'POST', body: JSON.stringify({ expo_push_token, platform }) }),
```

- [ ] **Step 2: `lib/pushNotifications.ts`** — replace with:
```ts
/** Expo push registration for either role (spec 2026-09-05 push §3). Best-effort,
 * native-only: simulators have no push, a denied permission is normal, and a
 * missing EAS projectId makes token minting throw — all silent no-ops. The
 * permission prompt appears on first entry to the member tabs or the mentor
 * console, never on the landing. */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { api } from './api';
import { listenerApi } from './listenerApi';

export type PushRole = 'member' | 'listener';

let lastToken: string | null = null;

async function currentToken(): Promise<string | null> {
  if (Platform.OS === 'web' || !Device.isDevice) return null;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') return null;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return data;
}

export async function registerPush(role: PushRole): Promise<void> {
  try {
    const token = await currentToken();
    if (!token) return;
    lastToken = token;
    const platform = Platform.OS === 'ios' ? 'ios' : 'android';
    if (role === 'member') await api.registerPushToken(token, platform);
    else await listenerApi.registerPushToken(token, platform);
  } catch {
    /* best-effort — see module doc */
  }
}

/** Start Fresh: stop the old persona's device from receiving anything. */
export async function unregisterPush(): Promise<void> {
  try {
    const token = lastToken ?? (await currentToken());
    if (token) await api.deletePushToken(token);
  } catch {
    /* best-effort */
  }
}

/** Kept for API compatibility with the tab shell. */
export const registerForPushNotifications = () => registerPush('member');
```
(No `LAST_TOKEN_KEY` constant — `lastToken` is an in-memory cache only; `unregisterPush` re-derives the token when the app was cold-started.)

- [ ] **Step 3: Wire.** `app/(tabs)/_layout.tsx`: keep `registerForPushNotifications()` or switch to `registerPush('member')` (either compiles). `app/mentor-home.tsx` `ConsoleBody`: `useEffect(() => { void registerPush('listener'); }, [])` once (import from `@/lib/pushNotifications`). `app/start-fresh.tsx` `confirm`: before `await clearSession();` add `await unregisterPush();`.

- [ ] **Step 4: Verify + commit.** `npx tsc --noEmit` clean.
```bash
git add lib/pushNotifications.ts lib/api.ts lib/listenerApi.ts "app/(tabs)/_layout.tsx" app/mentor-home.tsx app/start-fresh.tsx
git commit -m "feat(mobile): push registration for member and mentor roles; unregister on Start Fresh" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Mobile — foreground handler and tap routing

**Files:**
- Create: `lib/notifications.ts`, `lib/notifications.web.ts`, `lib/notificationRoute.ts`, `e2e/notifications-route.test.mjs`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Pure routing function** `lib/notificationRoute.ts` (no RN imports — testable in Node):
```ts
/** Where a notification tap lands (spec 2026-09-05 push §6). Pure: no I/O, no RN. */
export type PushData =
  | { kind: 'request'; request_id: string }
  | { kind: 'accepted'; conversation_id: string; stream_channel_id: string | null }
  | { kind: 'message'; conversation_id: string; stream_channel_id: string | null };

export type RouteCtx = {
  hasMemberSession: boolean;
  hasListenerToken: boolean;
  /** Member-owned conversation ids, resolved lazily for `message` taps. */
  memberConversationIds?: Set<string>;
};

export type Route = { pathname: string; params?: Record<string, string> };

export function routeForNotification(data: PushData | null | undefined, ctx: RouteCtx): Route | null {
  if (!data) return null;
  if (data.kind === 'request') return ctx.hasListenerToken ? { pathname: '/mentor-home' } : null;
  if (data.kind === 'accepted') {
    return ctx.hasMemberSession
      ? { pathname: '/chat/[id]', params: { id: data.conversation_id, channel: data.stream_channel_id ?? '' } }
      : null;
  }
  const mine = ctx.memberConversationIds?.has(data.conversation_id) ?? false;
  if (mine && ctx.hasMemberSession) {
    return { pathname: '/chat/[id]', params: { id: data.conversation_id, channel: data.stream_channel_id ?? '' } };
  }
  if (ctx.hasListenerToken) {
    return { pathname: '/mentor/chat/[id]', params: { id: data.conversation_id, channel: data.stream_channel_id ?? '' } };
  }
  if (ctx.hasMemberSession) return { pathname: '/chats' };
  return null;
}
```

- [ ] **Step 2: Node test** `e2e/notifications-route.test.mjs` (plain Node; transpile-free by importing the TS through a tiny inline copy is NOT acceptable — instead compile on the fly with `npx tsc lib/notificationRoute.ts --outDir .tmp-route --module es2020 --target es2020` in the test's own `npm` invocation):
```js
// Run: npx tsc lib/notificationRoute.ts --outDir .tmp-route --module es2020 --target es2020 && node e2e/notifications-route.test.mjs
import assert from 'node:assert/strict';
import { routeForNotification } from '../.tmp-route/notificationRoute.js';

const both = { hasMemberSession: true, hasListenerToken: true, memberConversationIds: new Set(['c-mine']) };
assert.deepEqual(routeForNotification({ kind: 'request', request_id: 'r' }, both), { pathname: '/mentor-home' });
assert.equal(routeForNotification({ kind: 'request', request_id: 'r' }, { hasMemberSession: true, hasListenerToken: false }), null);
assert.deepEqual(routeForNotification({ kind: 'accepted', conversation_id: 'c1', stream_channel_id: 'ch' }, both), { pathname: '/chat/[id]', params: { id: 'c1', channel: 'ch' } });
assert.deepEqual(routeForNotification({ kind: 'message', conversation_id: 'c-mine', stream_channel_id: 'ch' }, both), { pathname: '/chat/[id]', params: { id: 'c-mine', channel: 'ch' } });
assert.deepEqual(routeForNotification({ kind: 'message', conversation_id: 'c-theirs', stream_channel_id: 'ch' }, both), { pathname: '/mentor/chat/[id]', params: { id: 'c-theirs', channel: 'ch' } });
assert.deepEqual(routeForNotification({ kind: 'message', conversation_id: 'c-x', stream_channel_id: null }, { hasMemberSession: true, hasListenerToken: false }), { pathname: '/chats' });
assert.equal(routeForNotification({ kind: 'message', conversation_id: 'c-x', stream_channel_id: null }, { hasMemberSession: false, hasListenerToken: false }), null);
assert.equal(routeForNotification(null, both), null);
console.log('NOTIFICATION ROUTE TEST PASSED');
```
Add `.tmp-route/` to `apps/mobile/.gitignore`. Add to `package.json` scripts: `"test:route": "tsc lib/notificationRoute.ts --outDir .tmp-route --module es2020 --target es2020 && node e2e/notifications-route.test.mjs"`.

- [ ] **Step 3: `lib/notifications.ts`** (native):
```ts
/** Foreground banners without sound + tap routing (spec 2026-09-05 push §6). */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';

import { api } from '@/lib/api';
import { getListenerToken } from '@/lib/listenerSession';
import { routeForNotification, type PushData, type RouteCtx } from '@/lib/notificationRoute';
import { getSessionToken } from '@/lib/session';

export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false, // no audio anywhere (T&S #11)
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function buildCtx(data: PushData): Promise<RouteCtx> {
  const [session, listener] = await Promise.all([getSessionToken(), getListenerToken()]);
  const ctx: RouteCtx = { hasMemberSession: !!session, hasListenerToken: !!listener };
  if (data.kind === 'message' && session) {
    try {
      ctx.memberConversationIds = new Set((await api.listConversations()).map((c) => c.id));
    } catch {
      ctx.memberConversationIds = new Set();
    }
  }
  return ctx;
}

/** Mount once at the root layout. Handles cold-start taps and taps while running. */
export function useNotificationTaps(): void {
  const router = useRouter();
  useEffect(() => {
    let active = true;
    const handle = async (response: Notifications.NotificationResponse | null) => {
      const data = response?.notification.request.content.data as PushData | undefined;
      if (!data || !active) return;
      const route = routeForNotification(data, await buildCtx(data));
      if (route && active) router.push(route as never); // reason: expo-router typed routes reject a dynamic pathname string
    };
    void Notifications.getLastNotificationResponseAsync().then(handle);
    const sub = Notifications.addNotificationResponseReceivedListener((r) => void handle(r));
    return () => {
      active = false;
      sub.remove();
    };
  }, [router]);
}
```
Check whether the installed `expo-notifications` version's handler type includes `shouldShowBanner`/`shouldShowList`; if not, drop those two keys. If `router.push` rejects the `Route` object, use `router.push({ pathname: route.pathname as never, params: route.params })` with the same `// reason:` comment.
`lib/notifications.web.ts`:
```ts
/** Web: no push, no handler, no taps (the web console/app never receives pushes). */
export function installNotificationHandler(): void {}
export function useNotificationTaps(): void {}
```

- [ ] **Step 4: Wire into `app/_layout.tsx`:** import `{ installNotificationHandler, useNotificationTaps }` from `@/lib/notifications`; call `installNotificationHandler()` once at module scope (top of file, after imports); inside `RootLayout` call `useNotificationTaps();` next to `useShakeToUpdate();`.

- [ ] **Step 5: Verify + commit.** `npx tsc --noEmit` clean; `npm run test:route` → PASSED; restart Expo web `-c` and run `e2e/member-screens.e2e.js` (web module is the no-op; 0 page errors).
```bash
git add lib/notifications.ts lib/notifications.web.ts lib/notificationRoute.ts e2e/notifications-route.test.mjs app/_layout.tsx package.json .gitignore
git commit -m "feat(mobile): notification handler (banner, no sound) and tap routing to the right chat/console" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Docs, prod env, device proof

**Files:**
- Modify: `CLAUDE.md`, `docs/DECISIONS.md`, `PROGRESS.md`, `docs/PRIVACY.md`, `services/api/.env.example`, `apps/mobile/e2e/README.md`

- [ ] **Step 1: Docs.** CLAUDE.md Stack table: add a **Push** row (`expo-notifications` + Expo push API; registration both roles; sends: request/accepted/message, persona-only, watcher-suppressed; env `PUSH_ENABLED`). Key env vars: `PUSH_ENABLED`. DECISIONS §K.10: the five rulings (audience both; conversation events only; persona-only; watcher suppression; webhook + Expo, no queue). PROGRESS session entry. PRIVACY: one line per spec §5. `.env.example`: `PUSH_ENABLED=true`. e2e/README: the route test command.
- [ ] **Step 2: Prod.** After merge: push origin, `ssh mento-ops@87.232.72.79 'cd /opt/mento && ./deploy/backup-postgres.sh && ./deploy/deploy.sh'` (migration runs on boot), confirm `openapi.json` lists `/listener/me/push-token`.
- [ ] **Step 3: Device proof** (founder + session, per spec §8, on the release APK built against prod): register both roles on the phone; from the web member send a Personal request → push arrives → tap → Mentor Home; accept on the phone; from the web member send a message while the mentor chat is closed → push → tap → mentor chat; send while the chat is open → no push. Record results in PROGRESS.
- [ ] **Step 4: Commit** `docs: push notifications shipped — both roles, conversation events, persona-only (session 31f)`.

---

## Self-review against the spec

- §3 registration: T1 (columns, backfill, listener endpoint, delete, shared upsert), T4 (client both roles, permission on surface entry, unregister on Start Fresh) ✔. Send-time listener guard: T2 `_listener_ok` ✔.
- §4 triggers + suppression: T2 templates/rules 1–7 + crisis-as-plain + retry + DeviceNotRegistered; T3 wiring of all four events (request create on the non-idempotent path only; both accept paths; webhook background task after scan) ✔.
- §5 content/privacy: templates closed, data payload minimal (T2), no analytics (nothing added), PRIVACY line (T6) ✔.
- §6 app: handler no sound, `routeForNotification` pure + tested, `useNotificationTaps` cold start + live, web no-op (T5) ✔.
- §7 server pieces: all present (T1–T3); `push_enabled` + burst + watch cache settings (T1) ✔.
- §8 tests: ownership, triggers, all suppressions, crisis, resilience, disabled, migration (`alembic check`); mobile tsc + route test; device proof (T6) ✔.
- Type consistency: `push.notify_message(db, *, conversation_id, sender_stream_user_id)`, `notify_request_created(db, *, request_id)`, `notify_request_accepted(db, *, request_id)`, `notify_message_safe(channel_id, sender_id)` used identically in T2 tests, T3 wiring and the webhook; `_post_expo(messages) -> list[dict]` monkeypatched with the same signature; `PushOwnerKind` from `app.models.enums`; `registerPush(role)`/`unregisterPush()` in T4 and wired in T4; `routeForNotification(data, ctx)` in T5 file + test + hook.
- Placeholders: none.
