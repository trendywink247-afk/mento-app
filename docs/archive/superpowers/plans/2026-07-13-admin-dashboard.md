# Mento Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web-only `/admin` dashboard (cockpit + 7 tabs) giving the founder + trusted helpers every operational lever — crisis review, moderation, listener management, pulse, health, contributions stub, admin/audit — behind token-link auth, without ever compromising member anonymity.

**Architecture:** Mirror the proven listener-console pattern exactly. Backend: two new tables (`admin_accounts`, `admin_audit_log`), an admin-role JWT + `current_admin` dependency (per-request revocation), one `routers/admin_console.py` (prefix `/admin`), audit logging on every mutation and conversation view. Frontend: `app/admin/` web-only routes → `components/admin/*.web.tsx`, `lib/adminApi.ts` + `lib/adminSession.ts`, a cockpit shell with top tabs.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (sync) + Alembic + Postgres; Expo SDK 52 web (react-native-web), expo-router; Reanimated not needed (ops tool, minimal motion). Verification = pytest (Postgres) + `tsc --noEmit` + Playwright desktop 1280×900.

**Spec:** `docs/superpowers/specs/2026-07-13-admin-dashboard-design.md`

---

### Task 1: Admin data model + migration

**Files:**
- Create: `services/api/app/models/admin.py`
- Modify: `services/api/app/models/__init__.py`
- Modify: `services/api/app/models/enums.py`
- Create: `services/api/migrations/versions/<rev>_admin_accounts_audit.py`

- [ ] **Step 1: Add the AdminRole enum**

In `app/models/enums.py`, follow the existing enum style (find e.g. `class VettingStatus`) and add:

```python
class AdminRole(str, enum.Enum):
    owner = "owner"
    helper = "helper"


class AdminStatus(str, enum.Enum):
    active = "active"
    revoked = "revoked"
```

(If `enum` isn't imported at the top, it already is — the other classes use it.)

- [ ] **Step 2: Create `app/models/admin.py`**

```python
"""Admin accounts + an append-only audit log. Admins are the founder and a few
trusted helpers; every mutating action AND every conversation view writes an audit
row. Auth is a role-claimed JWT link (see security.py), revocable per-request."""
from __future__ import annotations

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import AdminRole, AdminStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class AdminAccount(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "admin_accounts"

    name: Mapped[str] = mapped_column(String(64))
    role: Mapped[AdminRole] = mapped_column(default=AdminRole.helper, index=True)
    status: Mapped[AdminStatus] = mapped_column(default=AdminStatus.active, index=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


class AdminAuditLog(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "admin_audit_log"

    admin_id: Mapped[str] = mapped_column(String(36), index=True)
    admin_name: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(64), index=True)  # e.g. flag.reviewed
    subject_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
```

- [ ] **Step 3: Register the models**

In `app/models/__init__.py` add the imports and `__all__` entries (alphabetical with the rest):

```python
from app.models.admin import AdminAccount, AdminAuditLog
```
and add `"AdminAccount",` and `"AdminAuditLog",` to `__all__`.

- [ ] **Step 4: Generate + hand-verify the migration**

Run: `cd services/api && .venv/Scripts/python.exe -m alembic revision --autogenerate -m "admin_accounts_audit"`
Open the new file under `migrations/versions/`. Confirm it `create_table`s both `admin_accounts` and `admin_audit_log` with the indexes (role, status, admin_id, action). Remove any spurious drops of unrelated tables if autogen added them.

- [ ] **Step 5: Apply + verify schema matches models**

Run: `.venv/Scripts/python.exe -m alembic upgrade head && .venv/Scripts/python.exe -m alembic check`
Expected: upgrade runs; check prints "No new upgrade operations detected."

- [ ] **Step 6: Commit**

```bash
git add services/api/app/models/admin.py services/api/app/models/__init__.py services/api/app/models/enums.py services/api/migrations/versions/
git commit -m "feat(api): admin_accounts + admin_audit_log models + migration"
```

---

### Task 2: Admin JWT + `current_admin` dependency + audit helper

**Files:**
- Modify: `services/api/app/security.py`
- Create: `services/api/app/services/audit.py`
- Test: `services/api/tests/test_admin_auth.py`

- [ ] **Step 1: Write the failing test**

Create `services/api/tests/test_admin_auth.py`:

```python
"""Admin auth: role isolation (user/listener/admin mutually reject) + per-request
revocation (status=revoked kills outstanding links immediately)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.enums import AdminRole, AdminStatus
from app.security import issue_admin_token, issue_listener_token, issue_session_token

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


def _seed_admin(s, *, role=AdminRole.owner, status=AdminStatus.active) -> str:
    a = AdminAccount(name="Founder", role=role, status=status)
    s.add(a)
    s.flush()
    return a.id


@requires_postgres
def test_admin_token_opens_admin_only(client, db_session):
    admin_id = _seed_admin(db_session)
    db_session.commit()
    ok = client.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"})
    assert ok.status_code == 200 and ok.json()["role"] == "owner"
    # A user or listener token must NOT open an admin endpoint.
    assert client.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {issue_session_token('u1')}"}).status_code == 401
    assert client.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {issue_listener_token('l1')}"}).status_code == 401


@requires_postgres
def test_revoked_admin_is_rejected_immediately(client, db_session):
    admin_id = _seed_admin(db_session, status=AdminStatus.revoked)
    db_session.commit()
    r = client.get("/api/v1/admin/me", headers={"Authorization": f"Bearer {issue_admin_token(admin_id)}"})
    assert r.status_code == 403
```

- [ ] **Step 2: Run it — fails (no issue_admin_token, no /admin/me yet)**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_auth.py -q`
Expected: ImportError / 404s.

- [ ] **Step 3: Add admin token functions to `security.py`**

After `issue_listener_token` add:

```python
def issue_admin_token(admin_id: str) -> str:
    """Mint an admin-console JWT (role claim; revocation = per-request status check)."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": admin_id,
        "role": "admin",
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=_settings.listener_jwt_ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _settings.jwt_secret, algorithm=_ALGO)
```

In `current_user_id`, the existing guard rejects `role == "listener"`; broaden it to reject any non-user role. Replace its role check with:

```python
    if payload.get("role") in ("listener", "admin"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not a user session")
```

Then add:

```python
def current_admin_id(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> str:
    """Resolve the admin id from a role-claimed bearer token."""
    payload = _decode(creds)
    if payload.get("role") != "admin":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not an admin session")
    admin_id = payload.get("sub")
    if not admin_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "malformed session")
    return admin_id
```

Also confirm `current_listener_id` rejects admin tokens — it already checks `role != "listener"`, so an admin token (role="admin") is rejected. Good.

- [ ] **Step 4: Create the audit helper `app/services/audit.py`**

```python
"""One writer for the admin audit trail. Called by every mutating admin endpoint
AND every conversation view (reads are logged). Never stores message content."""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.admin import AdminAccount, AdminAuditLog


def record(
    db: Session,
    admin: AdminAccount,
    action: str,
    *,
    subject_type: str | None = None,
    subject_id: str | None = None,
    meta: dict | None = None,
) -> None:
    db.add(
        AdminAuditLog(
            admin_id=admin.id,
            admin_name=admin.name,
            action=action,
            subject_type=subject_type,
            subject_id=subject_id,
            meta=meta or {},
        )
    )
    # Caller commits (usually alongside the mutation, so audit + action are atomic).
```

- [ ] **Step 5: Create the admin router skeleton with `/admin/me` (so the test can pass)**

This is fleshed out in Task 4; for now create `app/routers/admin_console.py`:

```python
"""Admin dashboard API (spec 2026-07-13). Web-only console; token-link auth with
per-request revocation; every mutation + conversation view is audit-logged.
Anonymity holds: personas only, message bodies never stored."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.admin import AdminAccount
from app.models.enums import AdminStatus
from app.schemas import AdminMeOut
from app.security import current_admin_id

router = APIRouter(prefix="/admin", tags=["admin"])


def current_admin(
    admin_id: str = Depends(current_admin_id),
    db: Session = Depends(get_db),
) -> AdminAccount:
    """Load the admin; status is checked every request so revoke is instant."""
    admin = db.get(AdminAccount, admin_id)
    if admin is None or admin.status != AdminStatus.active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin access revoked")
    return admin


def require_owner(admin: AdminAccount = Depends(current_admin)) -> AdminAccount:
    from app.models.enums import AdminRole

    if admin.role != AdminRole.owner:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "owner only")
    return admin


@router.get("/me", response_model=AdminMeOut)
def me(admin: AdminAccount = Depends(current_admin)) -> AdminMeOut:
    return AdminMeOut(id=admin.id, name=admin.name, role=admin.role.value)
```

Add `AdminMeOut` to `app/schemas.py`:

```python
class AdminMeOut(BaseModel):
    id: str
    name: str
    role: str
```

Register the router in `app/main.py`: add `admin_console` to the routers import and `app.include_router(admin_console.router, prefix=API)`.

- [ ] **Step 6: Run the tests — pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_auth.py -q`
Expected: 2 passed.

- [ ] **Step 7: Commit**

```bash
git add services/api/app/security.py services/api/app/services/audit.py services/api/app/routers/admin_console.py services/api/app/schemas.py services/api/app/main.py services/api/tests/test_admin_auth.py
git commit -m "feat(api): admin JWT + current_admin (per-request revocation) + audit writer"
```

---

### Task 3: Bootstrap script — create the first owner

**Files:**
- Create: `services/api/scripts/issue_admin_token.py`

- [ ] **Step 1: Write the script**

```python
"""Create (or re-link) an admin and print a console link.

    python -m scripts.issue_admin_token --owner --name "Founder"
    python -m scripts.issue_admin_token --name "Helper"          # helper
    python -m scripts.issue_admin_token --admin-id <uuid>        # re-link existing

Prints /admin#token=... (a URL fragment — never in server logs). Revoke from the
Admins tab, or by flipping status=revoked."""
from __future__ import annotations

import argparse

from app.db import SessionLocal
from app.models.admin import AdminAccount
from app.models.enums import AdminRole
from app.security import issue_admin_token


def main() -> None:
    p = argparse.ArgumentParser(description="Create an admin and print a console link.")
    p.add_argument("--admin-id", help="Re-issue a link for an existing admin UUID")
    p.add_argument("--name", help="Name for a NEW admin")
    p.add_argument("--owner", action="store_true", help="Make the new admin an owner")
    p.add_argument("--base-url", default="http://localhost:8081")
    args = p.parse_args()

    db = SessionLocal()
    try:
        if args.admin_id:
            admin = db.get(AdminAccount, args.admin_id)
            if admin is None:
                raise SystemExit("No such admin.")
        else:
            if not args.name:
                raise SystemExit("--name is required to create a new admin.")
            admin = AdminAccount(
                name=args.name,
                role=AdminRole.owner if args.owner else AdminRole.helper,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
        token = issue_admin_token(admin.id)
        print(f"Admin: {admin.name} ({admin.role.value}) [{admin.id}]")
        print(f"Console link: {args.base_url.rstrip('/')}/admin#token={token}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke-test it**

Run: `.venv/Scripts/python.exe -m scripts.issue_admin_token --owner --name "Founder"`
Expected: prints an admin row + an `/admin#token=...` link. Save this link — you'll use it in Task 11+ verification.

- [ ] **Step 3: Commit**

```bash
git add services/api/scripts/issue_admin_token.py
git commit -m "feat(api): issue_admin_token bootstrap script"
```

---

### Task 4: Overview endpoint (cockpit data)

**Files:**
- Modify: `services/api/app/routers/admin_console.py`
- Modify: `services/api/app/schemas.py`
- Test: `services/api/tests/test_admin_console.py`

- [ ] **Step 1: Write the failing test**

Create `services/api/tests/test_admin_console.py`:

```python
"""Admin dashboard endpoints: overview counts, safety review + live view + audit,
moderation resolve + suspend, listener CRUD, health, admins + audit."""
from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.admin import AdminAccount
from app.models.conversation import Conversation
from app.models.enums import (
    AdminRole,
    ConversationStatus,
    ListenerStatus,
    SafetySignal,
    VettingStatus,
)
from app.models.listener import ListenerProfile
from app.models.safety import SafetyFlag
from app.models.user import User
from app.security import issue_admin_token
from app.services import stream

from .conftest import TestSession, requires_postgres


@pytest.fixture(autouse=True)
def _stream_stub(monkeypatch):
    monkeypatch.setattr(stream, "create_dm_channel", lambda channel_id, user_id, listener_id: channel_id)
    monkeypatch.setattr(stream, "user_token", lambda uid: f"stub::{uid}")


@pytest.fixture
def client():
    return TestClient(app)


def _admin(s, role=AdminRole.owner) -> str:
    a = AdminAccount(name="Founder", role=role)
    s.add(a)
    s.flush()
    return a.id


def _auth(admin_id: str) -> dict:
    return {"Authorization": f"Bearer {issue_admin_token(admin_id)}"}


def _user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    return u.id


def _listener(s, **kw) -> str:
    li = ListenerProfile(
        persona_name=kw.get("name", "Open River"), persona_avatar="river",
        categories=["loneliness"], status=ListenerStatus.online,
        vetting_status=kw.get("vetting", VettingStatus.approved),
        rank=10, active_conversations=0, max_concurrent=3,
    )
    s.add(li)
    s.flush()
    return li.id


@requires_postgres
def test_overview_counts_exclude_nothing_but_shape_is_right(client, db_session):
    admin_id = _admin(db_session)
    _listener(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/overview", headers=_auth(admin_id))
    assert r.status_code == 200
    body = r.json()
    for key in ("members_today", "matches_today", "active_conversations",
                "listeners_online", "flags_unreviewed", "reports_unreviewed", "attention"):
        assert key in body
    assert body["listeners_online"] == 1
```

- [ ] **Step 2: Run it — fails (no /admin/overview)**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_console.py::test_overview_counts_exclude_nothing_but_shape_is_right -q`
Expected: 404.

- [ ] **Step 3: Add the schema + endpoint**

`app/schemas.py`:

```python
class AttentionItem(BaseModel):
    kind: str
    text: str
    href: str


class AdminOverviewOut(BaseModel):
    members_today: int
    matches_today: int
    active_conversations: int
    listeners_online: int
    flags_unreviewed: int
    reports_unreviewed: int
    attention: list[AttentionItem]
```

`app/routers/admin_console.py` — add imports at top (`from datetime import datetime, timezone`, `from sqlalchemy import func, select`, the models `Conversation`, `ListenerProfile`, `SafetyFlag`, `ModerationEvent`, `User`, enums `ConversationStatus`, `ListenerStatus`, `SafetySignal`, `VettingStatus`) and:

```python
@router.get("/overview", response_model=AdminOverviewOut)
def overview(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminOverviewOut:
    start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def count(stmt) -> int:
        return db.execute(stmt).scalar_one()

    members_today = count(select(func.count()).select_from(User).where(User.created_at >= start))
    matches_today = count(
        select(func.count()).select_from(Conversation).where(Conversation.created_at >= start)
    )
    active = count(
        select(func.count()).select_from(Conversation).where(
            Conversation.status == ConversationStatus.active
        )
    )
    online = count(
        select(func.count()).select_from(ListenerProfile).where(
            ListenerProfile.status == ListenerStatus.online,
            ListenerProfile.vetting_status == VettingStatus.approved,
        )
    )
    flags = count(
        select(func.count()).select_from(SafetyFlag).where(
            SafetyFlag.reviewed.is_(False), SafetyFlag.signal != SafetySignal.none
        )
    )
    reports = count(
        select(func.count()).select_from(ModerationEvent).where(ModerationEvent.reviewed.is_(False))
    )

    attention: list[AttentionItem] = []
    if flags:
        attention.append(AttentionItem(kind="safety", text=f"{flags} crisis flag(s) to review", href="safety"))
    if reports:
        attention.append(AttentionItem(kind="moderation", text=f"{reports} report(s) to review", href="moderation"))
    return AdminOverviewOut(
        members_today=members_today, matches_today=matches_today,
        active_conversations=active, listeners_online=online,
        flags_unreviewed=flags, reports_unreviewed=reports, attention=attention,
    )
```

(Import `AdminOverviewOut, AttentionItem` from `app.schemas`.)

- [ ] **Step 4: Run — pass**

Run: `.venv/Scripts/python.exe -m pytest tests/test_admin_console.py -q`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/routers/admin_console.py services/api/app/schemas.py services/api/tests/test_admin_console.py
git commit -m "feat(api): admin overview endpoint (cockpit counts)"
```

---

### Task 5: Safety review — flags, live conversation view, review action

**Files:**
- Modify: `services/api/app/routers/admin_console.py`, `app/schemas.py`, `app/services/stream.py`
- Test: append to `services/api/tests/test_admin_console.py`

- [ ] **Step 1: Write the failing tests** (append to test file)

```python
@requires_postgres
def test_safety_flag_review_writes_audit(client, db_session):
    admin_id = _admin(db_session)
    uid = _user(db_session)
    lid = _listener(db_session)
    c = Conversation(type="anon", status=ConversationStatus.active, user_id=uid,
                     listener_id=lid, stream_channel_id="c-x1")
    db_session.add(c)
    db_session.flush()
    f = SafetyFlag(conversation_id=c.id, user_id=uid, signal=SafetySignal.self_harm)
    db_session.add(f)
    db_session.commit()

    lst = client.get("/api/v1/admin/safety/flags", headers=_auth(admin_id))
    assert lst.status_code == 200 and len(lst.json()) == 1
    fid = lst.json()[0]["id"]

    rev = client.post(f"/api/v1/admin/safety/flags/{fid}/review",
                      json={"action": "helpline_shown"}, headers=_auth(admin_id))
    assert rev.status_code == 200
    with TestSession() as s:
        from app.models.admin import AdminAuditLog
        from app.models.safety import SafetyFlag as SF
        assert s.get(SF, fid).reviewed is True
        actions = [a.action for a in s.query(AdminAuditLog).all()]
        assert "flag.reviewed" in actions


@requires_postgres
def test_live_conversation_view_is_audited(client, db_session, monkeypatch):
    monkeypatch.setattr(stream, "fetch_channel_messages",
                        lambda cid: [{"id": "m1", "text": "hi", "user_persona": "Quiet Cove", "at": "2026-07-13T00:00:00Z"}])
    admin_id = _admin(db_session)
    uid = _user(db_session)
    lid = _listener(db_session)
    c = Conversation(type="anon", status=ConversationStatus.active, user_id=uid,
                     listener_id=lid, stream_channel_id="c-x2")
    db_session.add(c)
    db_session.commit()
    r = client.get(f"/api/v1/admin/conversations/{c.id}/messages", headers=_auth(admin_id))
    assert r.status_code == 200 and r.json()[0]["text"] == "hi"
    with TestSession() as s:
        from app.models.admin import AdminAuditLog
        assert "conversation.viewed" in [a.action for a in s.query(AdminAuditLog).all()]
```

- [ ] **Step 2: Run — fails** (`.venv/Scripts/python.exe -m pytest tests/test_admin_console.py -q`) → 404s / missing attr.

- [ ] **Step 3: Add `fetch_channel_messages` to `app/services/stream.py`**

```python
def fetch_channel_messages(channel_id: str) -> list[dict]:
    """Read-only crisis-review fetch — messages live in Stream, never stored here.
    Returns persona-tagged rows; empty in stub mode."""
    client = _client()
    if client is None:
        return []
    channel = client.channel("messaging", channel_id)
    state = channel.query(messages={"limit": 100})
    out = []
    for m in state.get("messages", []):
        out.append({
            "id": m.get("id"),
            "text": m.get("text") or "",
            "user_persona": (m.get("user") or {}).get("name") or "Member",
            "at": str(m.get("created_at") or ""),
        })
    return out
```

- [ ] **Step 4: Add schemas + endpoints**

`app/schemas.py`:

```python
class AdminFlagItem(BaseModel):
    id: str
    signal: str
    conversation_id: str | None
    member_persona: str | None
    listener_persona: str | None
    reviewed: bool
    created_at: str


class AdminFlagReviewIn(BaseModel):
    action: Literal["helpline_shown", "escalated", "no_action"]
    note: str | None = Field(default=None, max_length=500)


class AdminMessageItem(BaseModel):
    id: str
    text: str
    user_persona: str
    at: str
```

`app/routers/admin_console.py`:

```python
@router.get("/safety/flags", response_model=list[AdminFlagItem])
def safety_flags(
    reviewed: bool = False,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminFlagItem]:
    rows = db.execute(
        select(SafetyFlag).where(
            SafetyFlag.reviewed.is_(reviewed), SafetyFlag.signal != SafetySignal.none
        ).order_by(SafetyFlag.created_at.desc()).limit(200)
    ).scalars().all()
    out = []
    for f in rows:
        member = listener = None
        if f.conversation_id:
            convo = db.get(Conversation, f.conversation_id)
            if convo:
                u = db.get(User, convo.user_id)
                li = db.get(ListenerProfile, convo.listener_id)
                member = u.persona_name if u else None
                listener = li.persona_name if li else None
        out.append(AdminFlagItem(
            id=f.id, signal=f.signal.value, conversation_id=f.conversation_id,
            member_persona=member, listener_persona=listener,
            reviewed=f.reviewed, created_at=f.created_at.isoformat(),
        ))
    return out


@router.post("/safety/flags/{flag_id}/review", response_model=OkResult)
def review_flag(
    flag_id: str,
    payload: AdminFlagReviewIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    flag = db.get(SafetyFlag, flag_id)
    if flag is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "flag not found")
    flag.reviewed = True
    flag.reviewed_by = admin.name
    flag.action = payload.action
    audit.record(db, admin, "flag.reviewed", subject_type="safety_flag",
                 subject_id=flag_id, meta={"action": payload.action})
    db.commit()
    return OkResult(status="reviewed")


@router.get("/conversations/{convo_id}/messages", response_model=list[AdminMessageItem])
def conversation_messages(
    convo_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminMessageItem]:
    """Read-only live view for crisis review. Fetched from Stream, never stored.
    The VIEW itself is audit-logged (reads are accountable)."""
    convo = db.get(Conversation, convo_id)
    if convo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "conversation not found")
    audit.record(db, admin, "conversation.viewed", subject_type="conversation", subject_id=convo_id)
    db.commit()
    msgs = stream.fetch_channel_messages(convo.stream_channel_id or "")
    return [AdminMessageItem(**m) for m in msgs]
```

Add imports: `from app.services import audit, stream`; `OkResult`, `AdminFlagItem`, `AdminFlagReviewIn`, `AdminMessageItem` from schemas.

- [ ] **Step 5: Run — pass** (`.venv/Scripts/python.exe -m pytest tests/test_admin_console.py -q`) → all passed.

- [ ] **Step 6: Commit**

```bash
git add services/api/app/routers/admin_console.py services/api/app/schemas.py services/api/app/services/stream.py services/api/tests/test_admin_console.py
git commit -m "feat(api): admin safety review — flags, audited live conversation view, review action"
```

---

### Task 6: Moderation — queue, resolve, suspend/reinstate

**Files:** Modify `admin_console.py`, `schemas.py`; append tests.

- [ ] **Step 1: Failing test** (append)

```python
@requires_postgres
def test_suspend_listener_revokes_and_audits(client, db_session):
    from app.models.enums import VettingStatus as VS
    admin_id = _admin(db_session)
    lid = _listener(db_session)
    db_session.commit()
    r = client.post(f"/api/v1/admin/listeners/{lid}/suspend", headers=_auth(admin_id))
    assert r.status_code == 200
    with TestSession() as s:
        assert s.get(ListenerProfile, lid).vetting_status == VS.suspended
        from app.models.admin import AdminAuditLog
        assert "listener.suspended" in [a.action for a in s.query(AdminAuditLog).all()]
    assert client.post(f"/api/v1/admin/listeners/{lid}/reinstate", headers=_auth(admin_id)).status_code == 200
    with TestSession() as s:
        assert s.get(ListenerProfile, lid).vetting_status == VS.approved
```

- [ ] **Step 2: Run — fails** → 404.

- [ ] **Step 3: Add endpoints** to `admin_console.py`. Reuse the existing `ModerationItem` schema from `app/schemas.py`.

```python
@router.get("/moderation/queue", response_model=list[ModerationItem])
def moderation_queue(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[ModerationItem]:
    events = db.execute(
        select(ModerationEvent).where(ModerationEvent.reviewed.is_(False))
        .order_by(ModerationEvent.created_at.desc()).limit(200)
    ).scalars().all()
    return [
        ModerationItem(
            id=e.id, reporter_id=e.reporter_id, subject_id=e.subject_id,
            conversation_id=e.conversation_id, level=int(e.level.value),
            reason=e.reason, blocked=e.blocked, reviewed=e.reviewed,
            created_at=e.created_at.isoformat(),
        ) for e in events
    ]


@router.post("/moderation/{event_id}/resolve", response_model=OkResult)
def resolve_event(
    event_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    event = db.get(ModerationEvent, event_id)
    if event is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "event not found")
    event.reviewed = True
    event.reviewed_by = admin.name
    audit.record(db, admin, "moderation.resolved", subject_type="moderation_event", subject_id=event_id)
    db.commit()
    return OkResult(status="resolved")


@router.post("/listeners/{listener_id}/suspend", response_model=OkResult)
def suspend_listener(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    li.vetting_status = VettingStatus.suspended
    audit.record(db, admin, "listener.suspended", subject_type="listener", subject_id=listener_id)
    db.commit()
    return OkResult(status="suspended")


@router.post("/listeners/{listener_id}/reinstate", response_model=OkResult)
def reinstate_listener(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> OkResult:
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    li.vetting_status = VettingStatus.approved
    audit.record(db, admin, "listener.reinstated", subject_type="listener", subject_id=listener_id)
    db.commit()
    return OkResult(status="reinstated")
```

Import `ModerationItem` from schemas. `VettingStatus.suspended` must exist — verify in `app/models/enums.py` (it's used by the listener console suspension story, so it does).

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit** `feat(api): admin moderation queue + resolve + listener suspend/reinstate`

---

### Task 7: Listener management — roster, create, patch, console-link, requests

**Files:** Modify `admin_console.py`, `schemas.py`; append tests.

- [ ] **Step 1: Failing test** (append)

```python
@requires_postgres
def test_listener_roster_and_create_and_link(client, db_session):
    admin_id = _admin(db_session)
    _listener(db_session, name="Existing One")
    db_session.commit()
    roster = client.get("/api/v1/admin/listeners", headers=_auth(admin_id))
    assert roster.status_code == 200 and len(roster.json()) >= 1

    created = client.post("/api/v1/admin/listeners",
                          json={"categories": ["anxiety"], "max_concurrent": 4},
                          headers=_auth(admin_id))
    assert created.status_code == 200
    new_id = created.json()["id"]
    assert created.json()["persona_name"]  # auto-persona

    link = client.post(f"/api/v1/admin/listeners/{new_id}/console-link", headers=_auth(admin_id))
    assert link.status_code == 200 and "#token=" in link.json()["url"]
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Add schemas + endpoints.**

`app/schemas.py`:

```python
class AdminListenerItem(BaseModel):
    id: str
    persona_name: str
    persona_avatar: str
    vetting_status: str
    status: str
    categories: list[str]
    active_conversations: int
    max_concurrent: int
    rank: int


class AdminListenerCreateIn(BaseModel):
    categories: list[str] = []
    max_concurrent: int = Field(default=3, ge=1, le=20)


class AdminListenerPatchIn(BaseModel):
    categories: list[str] | None = None
    max_concurrent: int | None = Field(default=None, ge=1, le=20)
    rank: int | None = None


class AdminConsoleLinkOut(BaseModel):
    url: str
```

`app/routers/admin_console.py` (import the persona generator: `from app.services.persona import generate_persona`; `from app.security import issue_listener_token`; `from app.config import get_settings`):

```python
def _listener_item(li: ListenerProfile) -> AdminListenerItem:
    return AdminListenerItem(
        id=li.id, persona_name=li.persona_name, persona_avatar=li.persona_avatar,
        vetting_status=li.vetting_status.value, status=li.status.value,
        categories=li.categories or [], active_conversations=li.active_conversations,
        max_concurrent=li.max_concurrent, rank=li.rank,
    )


@router.get("/listeners", response_model=list[AdminListenerItem])
def admin_listeners(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminListenerItem]:
    rows = db.execute(select(ListenerProfile).order_by(ListenerProfile.persona_name.asc())).scalars().all()
    return [_listener_item(li) for li in rows]


@router.post("/listeners", response_model=AdminListenerItem)
def create_listener(
    payload: AdminListenerCreateIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminListenerItem:
    persona = generate_persona()
    li = ListenerProfile(
        persona_name=persona.name, persona_avatar=persona.avatar,
        categories=payload.categories, status=ListenerStatus.offline,
        vetting_status=VettingStatus.approved, rank=0,
        active_conversations=0, max_concurrent=payload.max_concurrent,
    )
    db.add(li)
    db.flush()
    audit.record(db, admin, "listener.created", subject_type="listener", subject_id=li.id)
    db.commit()
    db.refresh(li)
    return _listener_item(li)


@router.patch("/listeners/{listener_id}", response_model=AdminListenerItem)
def patch_listener(
    listener_id: str,
    payload: AdminListenerPatchIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminListenerItem:
    li = db.get(ListenerProfile, listener_id)
    if li is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "listener not found")
    if payload.categories is not None:
        li.categories = payload.categories
    if payload.max_concurrent is not None:
        li.max_concurrent = payload.max_concurrent
    if payload.rank is not None:
        li.rank = payload.rank
    audit.record(db, admin, "listener.updated", subject_type="listener", subject_id=listener_id)
    db.commit()
    db.refresh(li)
    return _listener_item(li)


@router.post("/listeners/{listener_id}/console-link", response_model=AdminConsoleLinkOut)
def listener_console_link(
    listener_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminConsoleLinkOut:
    li = db.get(ListenerProfile, listener_id)
    if li is None or li.vetting_status != VettingStatus.approved:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "approved listener not found")
    token = issue_listener_token(li.id)
    base = get_settings().console_base_url
    audit.record(db, admin, "listener.link_issued", subject_type="listener", subject_id=listener_id)
    db.commit()
    return AdminConsoleLinkOut(url=f"{base}/listener#token={token}")
```

Add `console_base_url: str = "http://localhost:8081"` to `Settings` in `app/config.py`.

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit** `feat(api): admin listener management — roster, create, patch, console-link`

---

### Task 8: Health + contributions stub

**Files:** Modify `admin_console.py`, `schemas.py`, `app/routers/stream_hooks.py`; append tests.

- [ ] **Step 1: Failing test** (append)

```python
@requires_postgres
def test_health_deep_shape(client, db_session):
    admin_id = _admin(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/health/deep", headers=_auth(admin_id))
    assert r.status_code == 200
    for key in ("db_ok", "redis_ok", "stream_configured", "last_webhook_at", "rate_limiter_ok"):
        assert key in r.json()


@requires_postgres
def test_contributions_empty_stub(client, db_session):
    admin_id = _admin(db_session)
    db_session.commit()
    r = client.get("/api/v1/admin/contributions", headers=_auth(admin_id))
    assert r.status_code == 200 and r.json() == []
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Stamp last-webhook time.** In `app/routers/stream_hooks.py`, at the top of `_scan_event` (runs on every inbound message), add a best-effort Redis stamp:

```python
    try:
        from app import ratelimit
        ratelimit._redis().set("mento:last_webhook_at", __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat())
    except Exception:
        pass
```

(Keep it wrapped — a Redis outage must never break the crisis path.)

- [ ] **Step 4: Add schemas + endpoints.**

`app/schemas.py`:

```python
class AdminHealthOut(BaseModel):
    db_ok: bool
    redis_ok: bool
    stream_configured: bool
    last_webhook_at: str | None
    rate_limiter_ok: bool


class AdminContributionItem(BaseModel):
    id: str
    amount_paise: int
    status: str
    created_at: str
```

`app/routers/admin_console.py`:

```python
@router.get("/health/deep", response_model=AdminHealthOut)
def health_deep(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminHealthOut:
    db_ok = True
    try:
        db.execute(select(func.count()).select_from(AdminAccount))
    except Exception:
        db_ok = False
    redis_ok = True
    last_webhook = None
    try:
        from app import ratelimit
        r = ratelimit._redis()
        r.ping()
        last_webhook = r.get("mento:last_webhook_at")
    except Exception:
        redis_ok = False
    return AdminHealthOut(
        db_ok=db_ok, redis_ok=redis_ok,
        stream_configured=stream.is_configured(),
        last_webhook_at=last_webhook, rate_limiter_ok=redis_ok,
    )


@router.get("/contributions", response_model=list[AdminContributionItem])
def admin_contributions(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminContributionItem]:
    # Razorpay not wired yet — the table schema is ready; ships empty until then.
    from app.models.contribution import Contribution
    rows = db.execute(select(Contribution).order_by(Contribution.created_at.desc()).limit(200)).scalars().all()
    return [
        AdminContributionItem(
            id=c.id, amount_paise=getattr(c, "amount_paise", 0),
            status=getattr(c, "status", "pending"), created_at=c.created_at.isoformat(),
        ) for c in rows
    ]
```

(Check the actual `Contribution` model field names in `app/models/contribution.py`; adjust `amount_paise`/`status` to match — do not invent fields.)

- [ ] **Step 5: Run — pass.**

- [ ] **Step 6: Commit** `feat(api): admin health (incl. last-webhook stamp) + contributions stub`

---

### Task 9: Admins management + audit log

**Files:** Modify `admin_console.py`, `schemas.py`; append tests.

- [ ] **Step 1: Failing test** (append)

```python
@requires_postgres
def test_owner_adds_and_revokes_helper_helper_cannot(client, db_session):
    owner_id = _admin(db_session, role=AdminRole.owner)
    db_session.commit()
    # Owner creates a helper.
    created = client.post("/api/v1/admin/admins", json={"name": "Helper"}, headers=_auth(owner_id))
    assert created.status_code == 200
    helper_id = created.json()["id"]
    assert "#token=" in created.json()["url"]
    # Helper cannot manage admins.
    from app.security import issue_admin_token
    helper_h = {"Authorization": f"Bearer {issue_admin_token(helper_id)}"}
    assert client.get("/api/v1/admin/admins", headers=helper_h).status_code == 403
    # Owner revokes the helper → helper is rejected.
    assert client.post(f"/api/v1/admin/admins/{helper_id}/revoke", headers=_auth(owner_id)).status_code == 200
    assert client.get("/api/v1/admin/me", headers=helper_h).status_code == 403


@requires_postgres
def test_audit_log_lists_actions(client, db_session):
    owner_id = _admin(db_session)
    lid = _listener(db_session)
    db_session.commit()
    client.post(f"/api/v1/admin/listeners/{lid}/suspend", headers=_auth(owner_id))
    log = client.get("/api/v1/admin/audit", headers=_auth(owner_id))
    assert log.status_code == 200
    assert any(row["action"] == "listener.suspended" for row in log.json())
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Add schemas + endpoints.**

`app/schemas.py`:

```python
class AdminAccountItem(BaseModel):
    id: str
    name: str
    role: str
    status: str
    created_at: str


class AdminCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)


class AdminCreatedOut(BaseModel):
    id: str
    url: str


class AdminAuditItem(BaseModel):
    id: str
    admin_name: str
    action: str
    subject_type: str | None
    subject_id: str | None
    created_at: str
```

`app/routers/admin_console.py` (import `AdminRole`, `AdminStatus`, `AdminAuditLog`, `issue_admin_token`):

```python
@router.get("/admins", response_model=list[AdminAccountItem], dependencies=[Depends(require_owner)])
def list_admins(db: Session = Depends(get_db)) -> list[AdminAccountItem]:
    rows = db.execute(select(AdminAccount).order_by(AdminAccount.created_at.asc())).scalars().all()
    return [
        AdminAccountItem(id=a.id, name=a.name, role=a.role.value,
                         status=a.status.value, created_at=a.created_at.isoformat())
        for a in rows
    ]


@router.post("/admins", response_model=AdminCreatedOut)
def create_admin(
    payload: AdminCreateIn,
    owner: AdminAccount = Depends(require_owner),
    db: Session = Depends(get_db),
) -> AdminCreatedOut:
    a = AdminAccount(name=payload.name, role=AdminRole.helper, created_by=owner.id)
    db.add(a)
    db.flush()
    audit.record(db, owner, "admin.created", subject_type="admin", subject_id=a.id)
    db.commit()
    db.refresh(a)
    token = issue_admin_token(a.id)
    return AdminCreatedOut(id=a.id, url=f"{get_settings().console_base_url}/admin#token={token}")


@router.post("/admins/{admin_id}/revoke", response_model=OkResult)
def revoke_admin(
    admin_id: str,
    owner: AdminAccount = Depends(require_owner),
    db: Session = Depends(get_db),
) -> OkResult:
    a = db.get(AdminAccount, admin_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "admin not found")
    if a.id == owner.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot revoke yourself")
    a.status = AdminStatus.revoked
    audit.record(db, owner, "admin.revoked", subject_type="admin", subject_id=admin_id)
    db.commit()
    return OkResult(status="revoked")


@router.get("/audit", response_model=list[AdminAuditItem])
def audit_log(
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminAuditItem]:
    rows = db.execute(
        select(AdminAuditLog).order_by(AdminAuditLog.created_at.desc()).limit(200)
    ).scalars().all()
    return [
        AdminAuditItem(id=a.id, admin_name=a.admin_name, action=a.action,
                       subject_type=a.subject_type, subject_id=a.subject_id,
                       created_at=a.created_at.isoformat())
        for a in rows
    ]
```

- [ ] **Step 4: Run the WHOLE suite** (`.venv/Scripts/python.exe -m pytest -q`) → all passed (37 existing + the new admin tests).

- [ ] **Step 5: Commit** `feat(api): admin management (owner-only) + audit log endpoint`

---

### Task 10: Frontend — admin session + typed client

**Files:**
- Create: `apps/mobile/lib/adminSession.ts`
- Create: `apps/mobile/lib/adminApi.ts`

- [ ] **Step 1: Create `lib/adminSession.ts`** (mirror of `listenerSession.ts`)

```ts
/** Admin-console session storage — its own key, distinct from user/listener so one
 * browser can hold all three (two-party + admin testing). Web-only console. */
const TOKEN_KEY = 'mento.admin.session_token';

export async function saveAdminToken(token: string): Promise<void> {
  globalThis.localStorage?.setItem(TOKEN_KEY, token);
}
export async function getAdminToken(): Promise<string | null> {
  return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
}
export async function clearAdminSession(): Promise<void> {
  globalThis.localStorage?.removeItem(TOKEN_KEY);
}
```

- [ ] **Step 2: Create `lib/adminApi.ts`** (mirror of `listenerApi.ts`)

```ts
/** Typed client for the admin dashboard (/admin endpoints), bound to the admin token. */
import { apiRequest } from '@/lib/api';
import { getAdminToken } from '@/lib/adminSession';

export type AdminMe = { id: string; name: string; role: 'owner' | 'helper' };
export type AttentionItem = { kind: string; text: string; href: string };
export type AdminOverview = {
  members_today: number; matches_today: number; active_conversations: number;
  listeners_online: number; flags_unreviewed: number; reports_unreviewed: number;
  attention: AttentionItem[];
};
export type AdminFlag = {
  id: string; signal: string; conversation_id: string | null;
  member_persona: string | null; listener_persona: string | null;
  reviewed: boolean; created_at: string;
};
export type AdminMessage = { id: string; text: string; user_persona: string; at: string };
export type AdminListener = {
  id: string; persona_name: string; persona_avatar: string; vetting_status: string;
  status: string; categories: string[]; active_conversations: number;
  max_concurrent: number; rank: number;
};
export type ModerationItem = {
  id: string; reporter_id: string | null; subject_id: string; conversation_id: string | null;
  level: number; reason: string | null; blocked: boolean; reviewed: boolean; created_at: string;
};
export type AdminHealth = {
  db_ok: boolean; redis_ok: boolean; stream_configured: boolean;
  last_webhook_at: string | null; rate_limiter_ok: boolean;
};
export type AdminAccountItem = { id: string; name: string; role: string; status: string; created_at: string };
export type AdminAuditItem = {
  id: string; admin_name: string; action: string;
  subject_type: string | null; subject_id: string | null; created_at: string;
};

function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, init, getAdminToken);
}

export const adminApi = {
  me: () => req<AdminMe>('/admin/me'),
  overview: () => req<AdminOverview>('/admin/overview'),
  flags: (reviewed = false) => req<AdminFlag[]>(`/admin/safety/flags?reviewed=${reviewed}`),
  reviewFlag: (id: string, action: string, note?: string) =>
    req<{ status: string }>(`/admin/safety/flags/${id}/review`, { method: 'POST', body: JSON.stringify({ action, note }) }),
  conversationMessages: (id: string) => req<AdminMessage[]>(`/admin/conversations/${id}/messages`),
  moderationQueue: () => req<ModerationItem[]>('/admin/moderation/queue'),
  resolveEvent: (id: string) => req<{ status: string }>(`/admin/moderation/${id}/resolve`, { method: 'POST' }),
  suspendListener: (id: string) => req<{ status: string }>(`/admin/listeners/${id}/suspend`, { method: 'POST' }),
  reinstateListener: (id: string) => req<{ status: string }>(`/admin/listeners/${id}/reinstate`, { method: 'POST' }),
  listeners: () => req<AdminListener[]>('/admin/listeners'),
  createListener: (categories: string[], max_concurrent: number) =>
    req<AdminListener>('/admin/listeners', { method: 'POST', body: JSON.stringify({ categories, max_concurrent }) }),
  patchListener: (id: string, body: Partial<{ categories: string[]; max_concurrent: number; rank: number }>) =>
    req<AdminListener>(`/admin/listeners/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  listenerLink: (id: string) => req<{ url: string }>(`/admin/listeners/${id}/console-link`, { method: 'POST' }),
  health: () => req<AdminHealth>('/admin/health/deep'),
  contributions: () => req<{ id: string; amount_paise: number; status: string; created_at: string }[]>('/admin/contributions'),
  admins: () => req<AdminAccountItem[]>('/admin/admins'),
  createAdmin: (name: string) => req<{ id: string; url: string }>('/admin/admins', { method: 'POST', body: JSON.stringify({ name }) }),
  revokeAdmin: (id: string) => req<{ status: string }>(`/admin/admins/${id}/revoke`, { method: 'POST' }),
  audit: () => req<AdminAuditItem[]>('/admin/audit'),
};
```

- [ ] **Step 3: Type-check** (`cd apps/mobile && npx tsc --noEmit`) → clean.

- [ ] **Step 4: Commit** `feat(mobile): admin session store + typed adminApi client`

---

### Task 11: Frontend — /admin routes + cockpit shell with tabs

**Files:**
- Create: `apps/mobile/app/admin/index.tsx` (route → web component; native stub)
- Create: `apps/mobile/components/admin/AdminConsole.web.tsx`
- Create: `apps/mobile/components/admin/AdminConsole.tsx` (native WebOnlyNotice — copy the listener native stub)

- [ ] **Step 1: Route file** `app/admin/index.tsx`:

```tsx
export { default } from '@/components/admin/AdminConsole';
```

- [ ] **Step 2: Native stub** `components/admin/AdminConsole.tsx` — copy `components/listener/ListenerConsole.tsx` (the WebOnlyNotice), changing copy to "The admin dashboard is web-only."

- [ ] **Step 3: Web shell** `components/admin/AdminConsole.web.tsx` — token boot (mirror ListenerConsole.web boot: `#token=` → save → strip; hashchange listener; Retry), then a tab bar + the active tab's panel. Tabs: Overview, Safety, Moderation, Listeners, Contributions, Health, Admins (Admins tab only rendered when `me.role === 'owner'`). Each tab body is a component from Tasks 12–14. Use `adminApi.me()` to gate. Show unreviewed badges on Safety/Moderation from `overview`.

Skeleton (fill tab bodies as they're built):

```tsx
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { adminApi, type AdminMe, type AdminOverview } from '@/lib/adminApi';
import { getAdminToken, saveAdminToken } from '@/lib/adminSession';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const TABS = ['Overview', 'Safety', 'Moderation', 'Listeners', 'Contributions', 'Health', 'Admins'] as const;
type Tab = (typeof TABS)[number];

export default function AdminConsoleWeb() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { colors, elevation } = useTheme();
  const [me, setMe] = useState<AdminMe | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      if (!(await getAdminToken())) { setError('No admin session. Open your console link again.'); return; }
      setMe(await adminApi.me());
      setOverview(await adminApi.overview());
      setError(null);
    } catch (e) {
      setError('This admin link is invalid, expired, or revoked. Ask the owner for a fresh one.');
    }
  }, []);

  const boot = useCallback(async () => {
    const hash = window.location.hash.match(/[#&]token=([^&]+)/);
    const token = hash?.[1] ? decodeURIComponent(hash[1]) : params.token;
    if (token) {
      await saveAdminToken(token);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      router.replace('/admin');
    }
    await load();
  }, [load, params.token, router]);

  useEffect(() => {
    void boot();
    const onHash = () => void boot();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [boot]);

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.center} testID="admin-error">
          <Text style={[type.body, { color: colors.ink, textAlign: 'center' }]}>{error}</Text>
          <Pressable onPress={() => void boot()} testID="admin-retry"><Text style={{ color: colors.accent }}>Retry</Text></Pressable>
        </View>
      </SafeAreaView>
    );
  }
  if (!me) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}><View style={styles.center}><Text style={{ color: colors.inkMuted }}>Opening the dashboard…</Text></View></SafeAreaView>;
  }

  const visibleTabs = TABS.filter((t) => t !== 'Admins' || me.role === 'owner');
  const badge = (t: Tab) => (t === 'Safety' ? overview?.flags_unreviewed : t === 'Moderation' ? overview?.reports_unreviewed : 0) || 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} testID="admin-ready">
      <View style={[styles.tabbar, { backgroundColor: colors.surface }, elevation.sm]}>
        {visibleTabs.map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} testID={`admin-tab-${t.toLowerCase()}`}
            style={[styles.tab, tab === t && { backgroundColor: colors.accentTint }]}>
            <Text style={[type.label, { color: tab === t ? colors.accent : colors.inkMuted }]}>
              {t}{badge(t) ? ` (${badge(t)})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        {/* Tab panels wired in Tasks 12–14 */}
        <Text style={{ color: colors.ink }}>{tab}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  tabbar: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, padding: space.sm },
  tab: { paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill },
  body: { padding: space.lg, gap: space.sm, maxWidth: 1100, width: '100%', alignSelf: 'center' },
});
```

- [ ] **Step 4: Type-check** → clean. **Playwright (desktop 1280×900):** open the `/admin#token=...` link from Task 3 → `admin-ready` renders, tab bar shows, 0 console errors. Bare `/admin` with no token → `admin-error`.

- [ ] **Step 5: Commit** `feat(mobile): /admin cockpit shell — token auth + tab bar`

---

### Task 12: Overview + Health tab panels

**Files:**
- Create: `apps/mobile/components/admin/panels/OverviewPanel.web.tsx`
- Create: `apps/mobile/components/admin/panels/HealthPanel.web.tsx`
- Modify: `AdminConsole.web.tsx` (render the panels)

- [ ] **Step 1: OverviewPanel** — stat tiles from `adminApi.overview()` (already fetched into `overview`; pass it as a prop) + the `attention` list as tappable rows that call a `onGoto(tab)` prop. HealthPanel — fetch `adminApi.health()`, render each check as a green/red row; `last_webhook_at` shows "stale" in red if older than 15 min.

Write both as focused presentational components taking data props. Then in `AdminConsole.web.tsx` replace the `{/* Tab panels */}` placeholder with a switch on `tab` rendering the right panel, passing `overview`, `me`, and a `setTab` goto handler.

- [ ] **Step 2: Type-check + Playwright** — Overview tile counts render; Health shows all five checks; 0 errors.

- [ ] **Step 3: Commit** `feat(mobile): admin Overview + Health panels`

---

### Task 13: Safety + Moderation tab panels

**Files:**
- Create: `apps/mobile/components/admin/panels/SafetyPanel.web.tsx`
- Create: `apps/mobile/components/admin/panels/ModerationPanel.web.tsx`
- Modify: `AdminConsole.web.tsx`

- [ ] **Step 1: SafetyPanel** — list `adminApi.flags()`; each row → "Open conversation" toggles an inline read-only message list from `adminApi.conversationMessages(convo_id)` (persona-labelled bubbles, no composer) + three review buttons (helpline_shown / escalated / no_action) calling `adminApi.reviewFlag`; on success remove the row and refresh the parent overview badge. ModerationPanel — list `adminApi.moderationQueue()`; each row shows reason/level/personas + Resolve and (for a listener subject) Suspend buttons.

- [ ] **Step 2: Type-check + Playwright** — seed a crisis flag (send "I want to end my life" through a member chat first), open Safety, open the conversation (messages render), mark reviewed (row clears). 0 errors.

- [ ] **Step 3: Commit** `feat(mobile): admin Safety review + Moderation panels`

---

### Task 14: Listeners + Contributions + Admins tab panels

**Files:**
- Create: `apps/mobile/components/admin/panels/ListenersPanel.web.tsx`
- Create: `apps/mobile/components/admin/panels/ContributionsPanel.web.tsx`
- Create: `apps/mobile/components/admin/panels/AdminsPanel.web.tsx`
- Modify: `AdminConsole.web.tsx`

- [ ] **Step 1:** ListenersPanel — roster from `adminApi.listeners()`; row actions: suspend/reinstate, "Copy console link" (calls `listenerLink`, copies `url` via `navigator.clipboard`, shows a toast), edit capacity/categories (simple inline controls calling `patchListener`); an "Add listener" control (categories multiselect + capacity → `createListener`). ContributionsPanel — `adminApi.contributions()` with an honest empty state ("No contributions yet — lands when Razorpay is wired."). AdminsPanel (owner-only) — `adminApi.admins()` list with Revoke buttons, an "Add admin" (name → `createAdmin`, shows the returned link to copy), and the `adminApi.audit()` log table below.

- [ ] **Step 2: Type-check + Playwright** — Listeners roster renders + copy-link works; Admins list renders + audit rows appear after an action. 0 errors.

- [ ] **Step 3: Commit** `feat(mobile): admin Listeners + Contributions + Admins panels`

---

### Task 15: Full owner E2E walk

**Files:**
- Create: `C:/tmp/playwright-admin.js`

- [ ] **Step 1: Write the E2E** — desktop 1280×900. Issue an owner link (`python -m scripts.issue_admin_token --owner --name "E2E Owner"`, parse the printed link). Then: open link → `admin-ready`; token stripped from URL; reload keeps session; Overview counts render; go to Listeners → suspend a listener → reinstate; copy a console link (assert a `#token=` string returned by the API call); Add a helper admin (assert link returned); go to Admins → revoke the helper; open the helper link in a fresh context → `admin-error` (revoked); Health shows checks. Assert 0 page errors throughout. Model it on `C:/tmp/playwright-test-console.js`.

- [ ] **Step 2: Run it** — `NODE_PATH=<playwright-skill node_modules> node C:/tmp/playwright-admin.js`. Expected: all OK lines, `OK 0 page errors`.

- [ ] **Step 3: Full suite green** — `.venv/Scripts/python.exe -m pytest -q` (all admin + prior tests), `cd apps/mobile && npx tsc --noEmit`.

- [ ] **Step 4: Docs + commit** — Update `CLAUDE.md` (SCOPE: admin dashboard now built; repo layout: `admin_console.py`, `components/admin/`), `PROGRESS.md` (session entry), and note the privacy-policy disclosure to-do. Retire the legacy static `x-admin-token` moderation/listeners endpoints IF nothing else uses them (grep first; if the listener admin stand-in still needs them, leave and note). Commit `feat: admin dashboard complete + docs`.

---

## Self-review notes

- **Spec coverage:** auth+revocation (T2), audit trail (T2 helper + logged everywhere + T9 view), overview (T4), safety+live view (T5), moderation+suspend (T6), listener mgmt (T7), health+webhook detector (T8), contributions stub (T8), admins+audit (T9), frontend shell (T11) + all 7 panels (T12–14), anonymity (personas-only in every schema; messages fetched-not-stored T5), owner-only (require_owner T2/T9), E2E (T15). All spec sections map to a task.
- **Placeholder scan:** panel Tasks 12–14 describe behavior with the exact adminApi methods to call rather than full JSX (each panel is a straightforward list/table over a typed client already fully specified in T10) — deliberate, to keep the plan readable; the data contracts are concrete. If executing via subagent, that's enough; if any ambiguity, follow the ListenerConsole.web panels as the pattern.
- **Type consistency:** endpoint response models (T4–T9) match the adminApi types (T10) field-for-field; `console_base_url` added in T7 and reused in T9; `require_owner`/`current_admin` defined in T2 and used in T6/T7/T9.
- **Deferred check:** `Contribution` model field names (T8) and `VettingStatus.suspended` (T6) must be verified against the actual code at execution — flagged inline in those tasks.
