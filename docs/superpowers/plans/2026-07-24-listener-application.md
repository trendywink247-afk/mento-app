# Listener Application Funnel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members apply from Profile to become peer listeners; admins approve/decline in the existing dashboard; approval creates a real listener and surfaces their private console link in-app.

**Architecture:** One new table (`listener_applications`) + a member router + three admin endpoints that reuse the existing listener-creation/token machinery (`admin_console.py`). Mobile adds one pushed route (apply form) and a status card in Profile. Admin web adds an Applications section inside the existing Listeners panel.

**Tech Stack:** FastAPI + SQLAlchemy 2 + Alembic (services/api), Expo/React Native + expo-router (apps/mobile), existing token-link auth for admin/listener consoles.

**Spec:** `docs/superpowers/specs/2026-07-24-listener-application-design.md`

**Ground rules from CLAUDE.md that bind every task:** design tokens only (no raw hex/durations), typed API clients only, pytest + `alembic check` + re-seed after pytest, `tsc --noEmit`, conventional commits, e2e at 390×844 with 0 page errors + reduced-motion pass.

---

### Task 1: ApplicationStatus enum + ListenerApplication model + migration

**Files:**
- Modify: `services/api/app/models/enums.py` (append)
- Create: `services/api/app/models/listener_application.py`
- Modify: `services/api/app/models/__init__.py` (add import so Alembic autogenerate sees the table — mirror how `listener.py` is imported there)
- Create: `services/api/migrations/versions/<autogen>_listener_applications.py`

- [ ] **Step 1: Append the enum** to `app/models/enums.py`:

```python
class ApplicationStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    declined = "declined"
```

- [ ] **Step 2: Create `app/models/listener_application.py`:**

```python
"""Listener application (spec 2026-07-24). A member's ask to become a peer
listener. Anonymous by design: tied to the persona/user id, no real names.
`decline_reason` is admin-internal and must never appear in member payloads."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models.enums import ApplicationStatus
from app.models.mixins import TimestampMixin, UUIDMixin


class ListenerApplication(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "listener_applications"

    user_id: Mapped[str] = mapped_column(String(36), index=True)
    motivation: Mapped[str] = mapped_column(Text)
    # Path lenses the applicant has walked (upsc/neet/jee/exams/life).
    communities: Mapped[list[str]] = mapped_column(JSON, default=list)
    availability: Mapped[str] = mapped_column(String(32))
    # Optional; stored for the day we can send the console link by email.
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Module B staging: interest flag only, nothing else of Module B ships.
    mentor_interest: Mapped[bool] = mapped_column(Boolean, default=False)

    status: Mapped[ApplicationStatus] = mapped_column(
        default=ApplicationStatus.pending, index=True
    )
    decline_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Set on approval — the ListenerProfile this application became.
    listener_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    pledge_accepted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 3: Register the model import** in `app/models/__init__.py`, alphabetically alongside the existing imports (open the file; add the line matching its established style, e.g. `from app.models.listener_application import ListenerApplication`).

- [ ] **Step 4: Generate + apply the migration** (Postgres must be up: `docker compose up -d --wait` in `services/api`):

Run (from `services/api`): `.\.venv\Scripts\python.exe -m alembic revision --autogenerate -m "listener applications"`
Expected: new file under `migrations/versions/` creating `listener_applications` only. Open it and confirm no unrelated diffs.

Run: `.\.venv\Scripts\python.exe -m alembic upgrade head` then `.\.venv\Scripts\python.exe -m alembic check`
Expected: upgrade succeeds; check reports no new upgrade operations.

- [ ] **Step 5: Commit**

```bash
git add services/api/app/models services/api/migrations/versions
git commit -m "feat(api): ListenerApplication model + migration"
```

---

### Task 2: Member endpoints — apply + my status

**Files:**
- Modify: `services/api/app/schemas.py` (append; match the file's existing Pydantic style)
- Create: `services/api/app/routers/listener_applications.py`
- Modify: `services/api/app/main.py` (register the router exactly like the `journals` router is registered)
- Create: `services/api/tests/test_listener_applications.py`

- [ ] **Step 1: Write the failing tests** — `tests/test_listener_applications.py`:

```python
"""Listener applications: lifecycle, one-open constraint, cooldown, privacy."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app.main import app
from app.models.enums import ApplicationStatus
from app.models.listener_application import ListenerApplication
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres

pytestmark = requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture(autouse=True)
def _clean():
    with TestSession() as s:
        s.execute(text("TRUNCATE users, listener_profiles, listener_applications CASCADE"))
        s.commit()
    yield


def _user(s) -> str:
    u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
    s.add(u)
    s.flush()
    s.commit()
    return u.id


def _auth(user_id: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {issue_session_token(user_id)}"}


PAYLOAD = {
    "motivation": "I've walked the UPSC road twice and know how lonely the wait after prelims gets.",
    "communities": ["upsc"],
    "availability": "most_evenings",
    "email": None,
    "mentor_interest": True,
    "pledge_accepted": True,
}


def test_apply_then_status(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["mentor_interest"] is True
    assert body["console_url"] is None

    me = client.get("/api/v1/listener-applications/me", headers=_auth(uid))
    assert me.status_code == 200
    assert me.json()["status"] == "pending"


def test_no_application_yet_returns_null(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.get("/api/v1/listener-applications/me", headers=_auth(uid))
    assert r.status_code == 200
    assert r.json() is None


def test_pledge_required(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post(
        "/api/v1/listener-applications",
        json={**PAYLOAD, "pledge_accepted": False},
        headers=_auth(uid),
    )
    assert r.status_code == 422


def test_unknown_community_rejected(client):
    with TestSession() as s:
        uid = _user(s)
    r = client.post(
        "/api/v1/listener-applications",
        json={**PAYLOAD, "communities": ["hogwarts"]},
        headers=_auth(uid),
    )
    assert r.status_code == 422


def test_one_open_application(client):
    with TestSession() as s:
        uid = _user(s)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 200
    r = client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    assert r.status_code == 409


def test_declined_cooldown_then_reapply(client):
    with TestSession() as s:
        uid = _user(s)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 200
    fresh_decline = datetime.now(timezone.utc)
    with TestSession() as s:
        s.query(ListenerApplication).update(
            {"status": ApplicationStatus.declined, "decline_reason": "internal note", "updated_at": fresh_decline}
        )
        s.commit()
    # Inside the 30-day cooldown → blocked.
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 409
    # Age the decline past the cooldown → allowed again.
    with TestSession() as s:
        s.query(ListenerApplication).update({"updated_at": fresh_decline - timedelta(days=31)})
        s.commit()
    assert client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid)).status_code == 200


def test_decline_reason_never_in_member_payload(client):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    with TestSession() as s:
        s.query(ListenerApplication).update(
            {"status": ApplicationStatus.declined, "decline_reason": "internal note"}
        )
        s.commit()
    body = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert body["status"] == "declined"
    assert "decline_reason" not in body
    assert "internal note" not in str(body)


def test_requires_auth(client):
    assert client.get("/api/v1/listener-applications/me").status_code in (401, 403)
    assert client.post("/api/v1/listener-applications", json=PAYLOAD).status_code in (401, 403)
```

Note: if the API is mounted at a different prefix than `/api/v1`, open an existing test (e.g. `tests/test_paths.py`) and use the same prefix it uses everywhere.

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `services/api`): `.\.venv\Scripts\python.exe -m pytest tests/test_listener_applications.py -v`
Expected: FAIL/ERROR — 404s (router not registered) or import errors.

- [ ] **Step 3: Append schemas** to `app/schemas.py` (match its imports; `Literal` from typing):

```python
class ListenerApplicationIn(BaseModel):
    motivation: str = Field(min_length=40, max_length=500)
    communities: list[str] = Field(default_factory=list, max_length=5)
    availability: Literal["few_hours", "most_evenings", "weekends", "varies"]
    email: str | None = None
    mentor_interest: bool = False
    pledge_accepted: bool


class ListenerApplicationOut(BaseModel):
    id: str
    status: str
    mentor_interest: bool
    created_at: str
    # Present only when approved: the applicant's private console link.
    console_url: str | None = None
```

- [ ] **Step 4: Create `app/routers/listener_applications.py`:**

```python
"""Become-a-listener applications (spec 2026-07-24).

Member-facing half of the funnel: apply + poll status. Approval/decline live in
the admin console router. `decline_reason` is deliberately absent from every
response here (T&S: no wound-poking)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import ratelimit
from app.config import get_settings
from app.db import get_db
from app.models.enums import ApplicationStatus
from app.models.listener_application import ListenerApplication
from app.schemas import ListenerApplicationIn, ListenerApplicationOut
from app.security import current_user_id, issue_listener_token
from app.services.paths_data import COMMUNITIES

router = APIRouter(prefix="/listener-applications", tags=["listener-applications"])

REAPPLY_COOLDOWN = timedelta(days=30)


def _out(a: ListenerApplication) -> ListenerApplicationOut:
    console_url = None
    if a.status == ApplicationStatus.approved and a.listener_id:
        token = issue_listener_token(a.listener_id)
        console_url = f"{get_settings().console_base_url}/listener#token={token}"
    return ListenerApplicationOut(
        id=a.id,
        status=a.status.value,
        mentor_interest=a.mentor_interest,
        created_at=a.created_at.isoformat(),
        console_url=console_url,
    )


def _latest(db: Session, user_id: str) -> ListenerApplication | None:
    return db.scalars(
        select(ListenerApplication)
        .where(ListenerApplication.user_id == user_id)
        .order_by(ListenerApplication.created_at.desc())
        .limit(1)
    ).first()


@router.post("", response_model=ListenerApplicationOut)
def apply(
    payload: ListenerApplicationIn,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerApplicationOut:
    ratelimit.enforce(
        f"listener-apply:{user_id}", 3, 24 * 3600,
        detail="Too many attempts today — please try again tomorrow.",
    )
    if not payload.pledge_accepted:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, "The listener pledge must be accepted."
        )
    unknown = [c for c in payload.communities if c not in COMMUNITIES]
    if unknown:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unknown community: {unknown[0]}")

    latest = _latest(db, user_id)
    if latest is not None:
        if latest.status in (ApplicationStatus.pending, ApplicationStatus.approved):
            raise HTTPException(status.HTTP_409_CONFLICT, "An application is already on file.")
        declined_at = latest.updated_at
        if declined_at.tzinfo is None:
            declined_at = declined_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) - declined_at < REAPPLY_COOLDOWN:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Please wait a little before applying again — we'd love to hear from you later.",
            )

    row = ListenerApplication(
        user_id=user_id,
        motivation=payload.motivation,
        communities=payload.communities,
        availability=payload.availability,
        email=payload.email,
        mentor_interest=payload.mentor_interest,
        pledge_accepted_at=datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row)


@router.get("/me", response_model=ListenerApplicationOut | None)
def my_application(
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
) -> ListenerApplicationOut | None:
    latest = _latest(db, user_id)
    return None if latest is None else _out(latest)
```

If `services/paths_data.py` exposes the communities under a different name than `COMMUNITIES` (check `app/services/paths_data.py`), use that name; the validation intent is "slug must be a known path community".

- [ ] **Step 5: Register the router** in `app/main.py`: find where `journals.router` is included and add `listener_applications.router` the same way (same prefix/dependency style).

- [ ] **Step 6: Run the tests**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_listener_applications.py -v`
Expected: all PASS.

- [ ] **Step 7: Full API gate + re-seed** (pytest truncates listeners):

Run: `.\.venv\Scripts\python.exe -m pytest` then `.\.venv\Scripts\python.exe -m alembic check` then `.\.venv\Scripts\python.exe -m scripts.seed_listeners`
Expected: whole suite green; check clean; 3 listeners re-seeded.

- [ ] **Step 8: Commit**

```bash
git add services/api/app services/api/tests/test_listener_applications.py
git commit -m "feat(api): member listener-application endpoints (apply + status)"
```

---

### Task 3: Admin endpoints — queue, approve, decline

**Files:**
- Modify: `services/api/app/schemas.py` (append admin items)
- Modify: `services/api/app/routers/admin_console.py` (new section near the listener endpoints)
- Modify: `services/api/tests/test_listener_applications.py` (append admin tests)

- [ ] **Step 1: Append the failing admin tests** to `tests/test_listener_applications.py`. First open the existing admin-console test file (`ls services/api/tests | grep -i admin`) and copy its admin-account + token fixture verbatim (it creates an `AdminAccount` row and calls `issue_admin_token`). Then append:

```python
# --- Admin half (fixtures: reuse the admin-token fixture from the admin tests) ---

def test_admin_queue_approve_creates_listener(client, admin_headers):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))

    q = client.get("/api/v1/admin/applications?status=pending", headers=admin_headers)
    assert q.status_code == 200
    items = q.json()
    assert len(items) == 1
    assert items[0]["persona_name"] == "Quiet Cove"
    app_id = items[0]["id"]

    ok = client.post(f"/api/v1/admin/applications/{app_id}/approve", headers=admin_headers)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "approved"

    # The member now sees an approved card with a working console link.
    me = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert me["status"] == "approved"
    assert me["console_url"] and "/listener#token=" in me["console_url"]

    # Approving again is a conflict.
    assert client.post(
        f"/api/v1/admin/applications/{app_id}/approve", headers=admin_headers
    ).status_code == 409


def test_admin_decline_records_private_reason(client, admin_headers):
    with TestSession() as s:
        uid = _user(s)
    client.post("/api/v1/listener-applications", json=PAYLOAD, headers=_auth(uid))
    app_id = client.get(
        "/api/v1/admin/applications?status=pending", headers=admin_headers
    ).json()[0]["id"]

    r = client.post(
        f"/api/v1/admin/applications/{app_id}/decline",
        json={"reason": "needs more lived experience"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    me = client.get("/api/v1/listener-applications/me", headers=_auth(uid)).json()
    assert me["status"] == "declined"
    assert "needs more lived experience" not in str(me)


def test_admin_endpoints_require_admin(client):
    assert client.get("/api/v1/admin/applications").status_code in (401, 403)
```

Also extend the `_clean` fixture's TRUNCATE list with whatever admin/audit tables the admin fixture needs cleaned (mirror the admin test file's fixture).

- [ ] **Step 2: Run to verify failure**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_listener_applications.py -v`
Expected: new tests FAIL with 404 (endpoints missing).

- [ ] **Step 3: Append admin schemas** to `app/schemas.py`:

```python
class AdminApplicationItem(BaseModel):
    id: str
    persona_name: str
    motivation: str
    communities: list[str]
    availability: str
    email: str | None
    mentor_interest: bool
    status: str
    created_at: str


class AdminApplicationDeclineIn(BaseModel):
    reason: str = Field(min_length=3, max_length=255)
```

- [ ] **Step 4: Add the endpoints** to `app/routers/admin_console.py`, in a new section directly below the listener endpoints (reuse the file's existing imports/`current_admin`/`audit` conventions; add imports for `ListenerApplication`, `ApplicationStatus`, `User`):

```python
# --- Listener applications (spec 2026-07-24) ----------------------------------

def _application_item(a: ListenerApplication, persona_name: str) -> AdminApplicationItem:
    return AdminApplicationItem(
        id=a.id,
        persona_name=persona_name,
        motivation=a.motivation,
        communities=a.communities or [],
        availability=a.availability,
        email=a.email,
        mentor_interest=a.mentor_interest,
        status=a.status.value,
        created_at=a.created_at.isoformat(),
    )


@router.get("/applications", response_model=list[AdminApplicationItem])
def admin_applications(
    status_filter: str | None = Query(default=None, alias="status"),
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> list[AdminApplicationItem]:
    stmt = select(ListenerApplication, User.persona_name).join(
        User, User.id == ListenerApplication.user_id
    ).order_by(ListenerApplication.created_at.asc())
    if status_filter:
        stmt = stmt.where(ListenerApplication.status == ApplicationStatus(status_filter))
    rows = db.execute(stmt).all()
    return [_application_item(a, persona_name) for a, persona_name in rows]


@router.post("/applications/{app_id}/approve", response_model=AdminApplicationItem)
def approve_application(
    app_id: str,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminApplicationItem:
    a = db.get(ListenerApplication, app_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "application not found")
    if a.status != ApplicationStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "application is not pending")
    applicant = db.get(User, a.user_id)
    if applicant is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "applicant no longer exists")

    li = ListenerProfile(
        persona_name=applicant.persona_name,
        persona_avatar=applicant.persona_avatar,
        categories=[],
        community_slug=(a.communities[0] if a.communities else None),
        status=ListenerStatus.offline,
        vetting_status=VettingStatus.approved,
        rank=0,
        active_conversations=0,
        max_concurrent=3,
    )
    db.add(li)
    db.flush()
    a.status = ApplicationStatus.approved
    a.listener_id = li.id
    audit.record(db, admin, "listener.application_approved", subject_type="application", subject_id=a.id)
    # TODO(email-provider): when an email service is wired, send the console
    # link to a.email here (spec: store now, send later).
    db.commit()
    db.refresh(a)
    return _application_item(a, applicant.persona_name)


@router.post("/applications/{app_id}/decline", response_model=AdminApplicationItem)
def decline_application(
    app_id: str,
    payload: AdminApplicationDeclineIn,
    admin: AdminAccount = Depends(current_admin),
    db: Session = Depends(get_db),
) -> AdminApplicationItem:
    a = db.get(ListenerApplication, app_id)
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "application not found")
    if a.status != ApplicationStatus.pending:
        raise HTTPException(status.HTTP_409_CONFLICT, "application is not pending")
    applicant = db.get(User, a.user_id)
    a.status = ApplicationStatus.declined
    a.decline_reason = payload.reason
    audit.record(db, admin, "listener.application_declined", subject_type="application", subject_id=a.id)
    db.commit()
    db.refresh(a)
    return _application_item(a, applicant.persona_name if applicant else "(deleted)")
```

- [ ] **Step 5: Run the tests, then the full gate**

Run: `.\.venv\Scripts\python.exe -m pytest tests/test_listener_applications.py -v` → all PASS.
Run: `.\.venv\Scripts\python.exe -m pytest` → suite green. `.\.venv\Scripts\python.exe -m alembic check` → clean. Re-seed: `.\.venv\Scripts\python.exe -m scripts.seed_listeners`.

- [ ] **Step 6: Commit**

```bash
git add services/api/app services/api/tests/test_listener_applications.py
git commit -m "feat(api): admin application queue with approve/decline reusing listener machinery"
```

---

### Task 4: Mobile typed client

**Files:**
- Modify: `apps/mobile/lib/api.ts` (append, member client)
- Modify: `apps/mobile/lib/adminApi.ts` (append, admin client)

- [ ] **Step 1: Append to `lib/api.ts`** (uses the file's internal `request<T>(path, init, auth)` helper — confirm its exact name/signature at `lib/api.ts:178` and match):

```ts
// --- Become a listener (spec 2026-07-24) ---
export type ListenerApplicationStatus = 'pending' | 'approved' | 'declined';
export type ListenerApplication = {
  id: string;
  status: ListenerApplicationStatus;
  mentor_interest: boolean;
  created_at: string;
  console_url: string | null;
};
export type ListenerApplicationIn = {
  motivation: string;
  communities: string[];
  availability: 'few_hours' | 'most_evenings' | 'weekends' | 'varies';
  email: string | null;
  mentor_interest: boolean;
  pledge_accepted: boolean;
};

export function submitListenerApplication(payload: ListenerApplicationIn) {
  return request<ListenerApplication>(
    '/listener-applications',
    { method: 'POST', body: JSON.stringify(payload) },
    true,
  );
}

export function getListenerApplication() {
  return request<ListenerApplication | null>('/listener-applications/me', {}, true);
}
```

- [ ] **Step 2: Append to `lib/adminApi.ts`** — open the file first and use its existing request helper + type conventions (it mirrors `api.ts` but binds the admin token). Add:

```ts
export type AdminApplication = {
  id: string;
  persona_name: string;
  motivation: string;
  communities: string[];
  availability: string;
  email: string | null;
  mentor_interest: boolean;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
};

export function listApplications(status?: string) {
  const qs = status ? `?status=${status}` : '';
  return adminRequest<AdminApplication[]>(`/admin/applications${qs}`);
}
export function approveApplication(id: string) {
  return adminRequest<AdminApplication>(`/admin/applications/${id}/approve`, { method: 'POST' });
}
export function declineApplication(id: string, reason: string) {
  return adminRequest<AdminApplication>(`/admin/applications/${id}/decline`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}
```

(`adminRequest` here stands for whatever helper the file actually exports/uses internally — match it exactly; do not hand-write fetch.)

- [ ] **Step 3: Typecheck**

Run (from `apps/mobile`): `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/lib/api.ts apps/mobile/lib/adminApi.ts
git commit -m "feat(mobile): typed client for listener applications (member + admin)"
```

---

### Task 5: Apply screen (`/listener-apply`)

**Files:**
- Create: `apps/mobile/app/listener-apply.tsx`

- [ ] **Step 1: Create the screen.** Standard pushed route (default slide animation — no `_layout` entry needed). Tokens only; chips are `Pressable`s styled like the profile colour swatches; keep every tap target ≥44px. Full component:

```tsx
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { submitListenerApplication, ApiError } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const COMMUNITIES = [
  { slug: 'upsc', label: 'UPSC' },
  { slug: 'neet', label: 'NEET' },
  { slug: 'jee', label: 'JEE' },
  { slug: 'exams', label: 'Other exams' },
  { slug: 'life', label: 'Life' },
];
const AVAILABILITY = [
  { key: 'few_hours', label: 'A few hours a week' },
  { key: 'most_evenings', label: 'Most evenings' },
  { key: 'weekends', label: 'Weekends' },
  { key: 'varies', label: 'It varies' },
] as const;

/** Become-a-listener application (spec 2026-07-24). One warm screen; the
 * pledge is a hard gate (T&S: listeners are not therapists). */
export default function ListenerApply() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const [motivation, setMotivation] = useState('');
  const [communities, setCommunities] = useState<string[]>([]);
  const [availability, setAvailability] = useState<(typeof AVAILABILITY)[number]['key'] | null>(null);
  const [email, setEmail] = useState('');
  const [mentorInterest, setMentorInterest] = useState(false);
  const [pledged, setPledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = motivation.trim().length >= 40 && availability !== null && pledged;

  const toggleCommunity = (slug: string) =>
    setCommunities((cs) => (cs.includes(slug) ? cs.filter((c) => c !== slug) : [...cs, slug]));

  const submit = async () => {
    if (!valid || submitting || availability === null) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitListenerApplication({
        motivation: motivation.trim(),
        communities,
        availability,
        email: email.trim() ? email.trim() : null,
        mentor_interest: mentorInterest,
        pledge_accepted: true,
      });
      router.back(); // Profile refetches on focus and shows the pending card
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
      setSubmitting(false);
    }
  };

  const chip = (selected: boolean) => [
    styles.chip,
    { backgroundColor: selected ? colors.accentTint : colors.surface, borderColor: selected ? colors.accent : colors.border },
  ];

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xl }}>
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          Become a listener
        </Text>
        <Text style={[type.body, styles.lede, { color: colors.inkMuted }]}>
          Listeners are the heart of Mento — people who've been through hard seasons and
          make time to sit with someone in theirs.
        </Text>

        <Text style={[styles.label, { color: colors.ink }]}>Why do you want to listen?</Text>
        <TextInput
          value={motivation}
          onChangeText={setMotivation}
          multiline
          maxLength={500}
          placeholder="A few honest sentences — what brings you here?"
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, { backgroundColor: colors.surface, color: colors.ink, borderColor: colors.border }]}
          testID="apply-motivation"
        />
        <Text style={[type.caption, { color: colors.inkMuted, textAlign: 'right' }]}>
          {motivation.trim().length < 40 ? `${40 - motivation.trim().length} more characters` : `${motivation.length}/500`}
        </Text>

        <Text style={[styles.label, { color: colors.ink }]}>Roads you've walked</Text>
        <View style={styles.chips}>
          {COMMUNITIES.map((c) => (
            <Pressable
              key={c.slug}
              onPress={() => toggleCommunity(c.slug)}
              accessibilityRole="button"
              accessibilityState={{ selected: communities.includes(c.slug) }}
              style={chip(communities.includes(c.slug))}
              testID={`apply-community-${c.slug}`}
            >
              <Text style={[type.bodySemi, { color: colors.ink }]}>{c.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.ink }]}>When could you usually listen?</Text>
        <View style={styles.chips}>
          {AVAILABILITY.map((a) => (
            <Pressable
              key={a.key}
              onPress={() => setAvailability(a.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: availability === a.key }}
              style={chip(availability === a.key)}
              testID={`apply-availability-${a.key}`}
            >
              <Text style={[type.bodySemi, { color: colors.ink }]}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { color: colors.ink }]}>Email (optional)</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          placeholder="Only for sending your listener link"
          placeholderTextColor={colors.inkMuted}
          style={[styles.input, styles.inputSingle, { backgroundColor: colors.surface, color: colors.ink, borderColor: colors.border }]}
          testID="apply-email"
        />

        <Pressable
          onPress={() => setMentorInterest((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: mentorInterest }}
          style={styles.checkRow}
          testID="apply-mentor-interest"
        >
          <Ionicons
            name={mentorInterest ? 'checkbox' : 'square-outline'}
            size={22}
            color={mentorInterest ? colors.accent : colors.inkMuted}
          />
          <Text style={[type.body, { color: colors.ink, flex: 1 }]}>
            I'd be interested in paid mentoring, later
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setPledged((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: pledged }}
          style={[styles.pledge, { backgroundColor: colors.surface }, elevation.sm]}
          testID="apply-pledge"
        >
          <Ionicons
            name={pledged ? 'checkbox' : 'square-outline'}
            size={22}
            color={pledged ? colors.accent : colors.inkMuted}
          />
          <Text style={[type.body, { color: colors.ink, flex: 1 }]}>
            Listeners are not therapists. I'll listen, not diagnose — and when someone
            needs clinical help, I'll point them toward it.
          </Text>
        </Pressable>

        {error ? (
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]} testID="apply-error">
            {error}
          </Text>
        ) : null}

        <View style={{ marginTop: space.md }}>
          <PrimaryButton
            label="Send application"
            onPress={() => void submit()}
            disabled={!valid}
            loading={submitting}
            testID="apply-submit"
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lede: { marginTop: space.xs, marginBottom: space.md },
  label: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23, marginTop: space.md, marginBottom: space.xs },
  input: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.sm,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  inputSingle: { minHeight: 48, textAlignVertical: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md, minHeight: 44 },
  pledge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
});
```

If `colors.border` doesn't exist in `theme/tokens.ts`, use the nearest existing hairline token (check what other bordered inputs in the app use, e.g. the onboarding email step) — never a raw hex.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → clean. Fix any token-name drift by reading `theme/tokens.ts`, not by inventing values.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/listener-apply.tsx
git commit -m "feat(mobile): become-a-listener application screen"
```

---

### Task 6: Profile row + status card

**Files:**
- Modify: `apps/mobile/app/(tabs)/profile.tsx`

- [ ] **Step 1: Wire state + fetch.** Add imports (`useFocusEffect`, `useCallback` from the existing import lines; `Linking` from `react-native`; `getListenerApplication`, type `ListenerApplication` from `@/lib/api`). Inside `ProfileTab`:

```tsx
const [application, setApplication] = useState<ListenerApplication | null>(null);

useFocusEffect(
  useCallback(() => {
    let active = true;
    void getListenerApplication()
      .then((a) => {
        if (active) setApplication(a);
      })
      .catch(() => {
        /* status card is best-effort; the row still renders */
      });
    return () => {
      active = false;
    };
  }, []),
);
```

- [ ] **Step 2: Render.** Directly above the Start-fresh row, insert: when `application` is null → the apply row; otherwise → the status card:

```tsx
{application === null ? (
  <Pressable
    onPress={() => router.push('/listener-apply')}
    accessibilityRole="button"
    testID="profile-become-listener"
    style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
  >
    <IconBadge icon="ear-outline" tone="green" size={44} />
    <View style={{ flex: 1 }}>
      <Text style={[type.label, { color: colors.ink }]}>Become a listener</Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>
        Been through a hard season? Help someone through theirs.
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
  </Pressable>
) : (
  <View
    style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
    testID="profile-listener-status"
  >
    <IconBadge
      icon={application.status === 'approved' ? 'checkmark-circle-outline' : 'ear-outline'}
      tone={application.status === 'approved' ? 'green' : undefined}
      size={44}
    />
    <View style={{ flex: 1 }}>
      <Text style={[type.label, { color: colors.ink }]}>
        {application.status === 'pending' && 'Listener application received'}
        {application.status === 'approved' && "You're a listener now"}
        {application.status === 'declined' && 'About your application'}
      </Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>
        {application.status === 'pending' && 'We read every application — hang tight.'}
        {application.status === 'approved' &&
          'Your private listener console is ready. It opens in your browser.'}
        {application.status === 'declined' &&
          'Not this time — and truly, thank you. You can apply again in a month.'}
      </Text>
      {application.status === 'approved' && application.console_url ? (
        <Pressable
          onPress={() => void Linking.openURL(application.console_url as string)}
          accessibilityRole="link"
          testID="profile-open-console"
          style={{ minHeight: 44, justifyContent: 'center' }}
        >
          <Text style={[type.bodySemi, { color: colors.accent }]}>Open my listener console →</Text>
        </Pressable>
      ) : null}
    </View>
  </View>
)}
```

Check `IconBadge`'s actual `tone` prop values before using `"green"` (it's used with `tone="green"` and `tone="orange"` elsewhere in this same file — copy those).

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → clean.

- [ ] **Step 4: Drive it in the browser** (backend seeded + Expo web running): complete onboarding, open `http://localhost:8081/profile`, see the Become-a-listener row → apply → submit → back on Profile with the pending card. 0 console errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/mobile/app/(tabs)/profile.tsx"
git commit -m "feat(mobile): profile entry + status card for listener applications"
```

---

### Task 7: Admin panel — Applications section

**Files:**
- Modify: `apps/mobile/components/admin/panels/ListenersPanel.web.tsx`

- [ ] **Step 1: Add the section.** Open the panel first and mirror its data-loading + styling conventions exactly (it already lists/creates listeners with `adminApi`). Add above the listener list: a "Applications" block that loads `listApplications('pending')` on mount and after every action, and renders per row — persona name, `motivation` (full text), community chips, availability, a `mentor-interest` badge when true, relative created-at — with two actions:
  - **Approve** → `approveApplication(id)` → refresh both the applications list and the listener list (a new listener just appeared).
  - **Decline** → a small inline text input for the required reason (button disabled until ≥3 chars) → `declineApplication(id, reason)` → refresh.
  - Empty state: "No pending applications." Errors surface in the panel's existing error style.

The code must follow the panel's existing component patterns — this is a web-only console file, so plain RN-web styling as the file already does it. Give the section `testID="admin-applications"` and per-row `testID={'admin-app-' + id}`.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → clean.

- [ ] **Step 3: Drive it in the browser.** Issue an admin link (`.\.venv\Scripts\python.exe -m scripts.issue_admin_token --owner --name "Dev"` from `services/api`), open it, Listeners tab: the pending application from Task 6's drive is visible; Approve it; listener list grows by one. Back in the member web app: Profile now shows the approved card with a console link that opens the listener console. 0 console errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/components/admin/panels/ListenersPanel.web.tsx
git commit -m "feat(admin): listener application queue with approve/decline"
```

---

### Task 8: E2E + docs + wrap

**Files:**
- Create: `apps/mobile/e2e/listener-apply.e2e.js`
- Modify: `apps/mobile/e2e/README.md` (add the one-line description)
- Modify: `PROGRESS.md` (session entry + Open decisions)

- [ ] **Step 1: Write the e2e** (repo style: plain Node, 390×844, headless, 0 page errors, second context with `reducedMotion: 'reduce'`):

```js
/** Become a listener: profile → apply → pending card (approval path is pytest-proven).
 * Optional: set MENTO_ADMIN_TOKEN to also drive approve → approved card + console link. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const API = 'http://localhost:8000/api/v1';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];

  const flow = async (contextOpts, label) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, ...contextOpts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e}`));
    const tid = (id) => page.locator(`[data-testid="${id}"]`);

    await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
    await tid('start').click();
    await page.waitForSelector('text=How old are you?', { timeout: 60000 });
    await tid('continue').click();
    await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
    await tid('skip').click();
    await page.waitForSelector('text=Your growth, your theme', { timeout: 30000 });
    await tid('animal-panda').click();
    await tid('colour-purple').click();
    await tid('continue').click();
    await page.waitForSelector('text=Mento space ready!', { timeout: 30000 });
    await tid('enter').click();
    await page.waitForURL(/\/chat\//, { timeout: 90000 });

    await page.goto(`${WEB}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
    await tid('profile-become-listener').click();
    await tid('apply-motivation').fill(
      "I've walked the UPSC road twice and know how lonely the wait after prelims gets."
    );
    await tid('apply-community-upsc').click();
    await tid('apply-availability-most_evenings').click();
    await tid('apply-pledge').click();
    await tid('apply-submit').click();
    await tid('profile-listener-status').waitFor({ timeout: 30000 });

    if (process.env.MENTO_ADMIN_TOKEN) {
      const res = await fetch(`${API}/admin/applications?status=pending`, {
        headers: { Authorization: `Bearer ${process.env.MENTO_ADMIN_TOKEN}` },
      });
      const [app] = await res.json();
      await fetch(`${API}/admin/applications/${app.id}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.MENTO_ADMIN_TOKEN}` },
      });
      await page.reload({ waitUntil: 'networkidle' });
      await tid('profile-open-console').waitFor({ timeout: 30000 });
    }

    console.log(`${label}: OK`);
    await ctx.close();
  };

  await flow({}, 'normal');
  await flow({ reducedMotion: 'reduce' }, 'reduced-motion');

  await browser.close();
  if (errors.length) {
    console.error('PAGE ERRORS:', errors);
    process.exit(1);
  }
  console.log('PASS listener-apply');
})().catch((e) => {
  console.error('FAIL:', e);
  process.exit(1);
});
```

Heads-up: two runs = two onboardings; if the run 429s, flush the window (`docker exec mento-redis redis-cli FLUSHDB`) per the mento-e2e skill.

- [ ] **Step 2: Run it**

Run (from `apps/mobile`): `NODE_PATH=<playwright-install>/node_modules node e2e/listener-apply.e2e.js`
Expected: `normal: OK`, `reduced-motion: OK`, `PASS listener-apply`.

- [ ] **Step 3: Docs.** Add the script's one-liner to `e2e/README.md`. Update `PROGRESS.md` (newest-on-top): Done = this feature end-to-end; Open decisions = **email provider for sending console links** (stored today, unsent), **DECISIONS.md needs the listener-application ruling recorded** (funnel + Module B staging flag), and **PostHog events** (`listener_application_submitted/approved/declined`, counts only per spec) land when PostHog is actually wired (`EXPO_PUBLIC_POSTHOG_KEY` is empty today — don't add dead analytics calls now).

- [ ] **Step 4: Final full verify** — the four Universal DoD gates: pytest + alembic check + re-seed (API touched), `tsc --noEmit` (mobile touched), the new e2e (flow touched), conventional commits already made per task.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/e2e PROGRESS.md
git commit -m "feat: listener application e2e + progress/docs"
```
