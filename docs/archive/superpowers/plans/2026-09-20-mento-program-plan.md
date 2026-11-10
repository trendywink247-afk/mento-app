# Mento Balanced Program — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a Level-1 master plan: before building any task card, its builder or a planner agent writes a bite-sized TDD sub-plan for that card with `superpowers:writing-plans` against the code as it stands then (section 2, step 2).

**Goal:** Build the Balanced architecture decided on 2026-09-20 (own chat on our server, hardened anonymous auth, Balanced 4 GB platform, safety desk and refined admin panel, store-ready app), launch in stages, and lose nothing on the way.

**Architecture:** One 4 GB server in India running Caddy, FastAPI (blue and green), a Procrastinate job worker, Postgres and Valkey; message write path with the crisis scan first; refresh-token auth; encrypted, partitioned message storage; off-site backups; Expo SDK 57 app with an own chat thread; Expo EAS Update stays for app updates. Design: `docs/superpowers/specs/2026-09-20-mento-balanced-architecture-design.md`.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Postgres 16, Valkey, Procrastinate, PyJWT, Caddy, Docker Compose, restic, GitHub Actions; Expo SDK 54 to 57, React Native, Reanimated 4, Skia 2, FlashList, react-native-keyboard-controller, expo-sqlite, Maestro, k6, Playwright.

---

## 1. Read this first

- Nothing in this plan touches production until the founder approves that step. Production SSH and deploy authority from 2026-09-19 must be re-confirmed in the session that runs the first production action.
- The design is settled except the open decisions in section 9. Tasks that depend on an open decision say so (marked **[D#]**).
- Task sizes: **S** up to half a day, **M** up to a day and a half, **L** up to three days. Anything larger is split before it starts.
- IDs: `T<workstream>.<n>` for agent tasks, `H<n>` for founder-only tasks.
- Each task ends with the verification commands in section 4 that apply to the layers it touches. A task is not done until they pass and a reviewer approves.

## 2. Operating model (how the program runs)

Roles, all on Opus (per founder rule, launch new subagents on `opus`):

| Role | Count | Job |
|---|---|---|
| **Conductor** | 1 (the main session) | Owns `docs/superpowers/program/STATUS.md`, dispatches waves, resolves conflicts, runs gates, asks the founder for approvals. Never writes feature code. |
| **Planner** | 1 per workstream at its start | Reads current code, writes the Level-2 TDD sub-plan (writing-plans format) for each task card, flags missing prerequisites. |
| **Builder** | 1 per task, fresh each time | Implements one task in the lane worktree with TDD, commits, reports. |
| **Spec reviewer** | 1 per task | Checks the diff against the task card's acceptance criteria only. |
| **Quality reviewer** | 1 per task | Checks code quality, tests, safety invariants, style. |
| **Integrator** | 1 per wave | Merges lane branches one at a time, runs the gate, fixes conflicts (locales, tokens, `lib/api.ts`, `requirements.txt` are the usual ones). |
| **Ops agent** | as needed | Runs production steps only after explicit founder approval, using `scripts/lanes/ship.sh`. |

Loop for every task card:

1. Conductor marks the card `in-progress` in STATUS.md and gives the builder its card, the invariants (section 3) and the lane path.
2. Planner (or builder if the card is S) produces the sub-plan: bite-sized steps with exact code and commands. Commit the sub-plan under `docs/superpowers/program/subplans/<task-id>.md`.
3. Builder implements test-first, one commit per step group, conventional commits.
4. Spec reviewer, then quality reviewer. Findings go back to the same builder until both approve.
5. Conductor runs the fast gate in the lane (`bash scripts/lanes/gate.sh fast`), marks the card `done`.
6. At the wave end the integrator merges lane branches one at a time and runs `bash scripts/lanes/gate.sh full`.

Lanes: the existing worktree lanes under `C:\ml\` created by `scripts/lanes/lane.ps1` (own database, Redis DB and ports per lane). Reuse the procedure in `docs/superpowers/plans/2026-09-19-board-port-lanes.md`. Merge one lane at a time.

`STATUS.md` format (the conductor keeps it current; agents never edit it):

```markdown
| ID | Title | Lane | Size | Status | Depends | Branch | Reviewed |
|---|---|---|---|---|---|---|---|
| T0.1 | Remove audio permissions | A | S | todo | - | - | - |
```

Escalate to the founder (stop and ask) when a task would: change a product rule in `CLAUDE.md`, weaken a safety invariant, touch production, spend money, or need a store-console action.

## 3. Invariants every task must keep

1. **Scan before store.** On the only message write path the crisis scan runs before allowance, redaction and persistence. Fail-open with a budget, never silent (an alert fires).
2. **Anonymity.** No real names, photos or identity in chat, avatars, metadata, logs or analytics. Mentors never see member age, email or identity.
3. **Clean Wipe is true.** Deleting a chat deletes message bodies from our servers, and backups never keep them.
4. **No PII or message text to third parties.** Sentry-compatible tracker is ours; analytics is a closed event list.
5. **Signal only.** `safety_flags` and any new signal table store type, category and score, never message text.
6. **Copy discipline.** Mentors, not therapists. Never use therapy, therapist, counselling, clinical, treatment, diagnosis, patient or cure in any string, English or Hindi.
7. **Migrations are forward-only.** Never edit a shipped migration. `alembic check` stays clean.
8. **Tokens and design.** Colours from `theme/tokens.ts`, durations from `theme/motion.ts`, strings through `useI18n().t()`, tappables through `PressKey`, typed API clients only.
9. **Motion.** Transform and opacity only, reduced motion honoured, no `entering=` or `exiting=`.
10. **Members are never pushed toward dependence.** No streaks, no check-ins, no AI text to members.

## 4. Verification commands

Run from `services/api` (PowerShell) for API changes:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe -m alembic check
.\.venv\Scripts\python.exe -m ruff check . ; .\.venv\Scripts\python.exe -m black --check .
.\.venv\Scripts\python.exe -m scripts.seed_listeners   # pytest truncates dev listeners
```

From `apps/mobile` for app changes:

```powershell
npx tsc --noEmit
node --test e2e/notifications-route.test.mjs e2e/question-builder.test.mjs e2e/companion-placement.test.mjs
```

For flows: web e2e specs in `apps/mobile/e2e/` at 390x844, once normally and once with `reducedMotion: 'reduce'`, zero page errors. Gate: `bash scripts/lanes/gate.sh fast` in a lane, `bash scripts/lanes/gate.sh full` at wave end. Ship (founder-approved only): `bash scripts/lanes/ship.sh "what changed"`.

## 5. Program map

| Wave | Purpose | Workstreams | Exit gate |
|---|---|---|---|
| **0** | Prepare and quick wins | WS0, conductor setup | Baseline gate green; STATUS.md exists; six lanes created |
| **1** | Foundations, in parallel | WS1, WS2 (part), WS3 (part), WS4, WS8 tooling, WS10 first cut, WS11 harness | Full gate green; Balanced stack runs locally in Docker from one command |
| **2** | Store-ready base | WS6 Expo chain, WS7, WS9 backend core, WS8 lanes, WS3 rest, WS2 rest | Play build targets API 36; refresh auth live behind flag; jobs live |
| **3** | Own chat and control room | WS5, WS6 chat client, WS9 UI, WS8 rest | Own chat passes scan-before-store, exactly-once, reconnect, wipe; native chat Maestro flows pass |
| **4** | Prove it | Cutover rehearsals, k6, drills, WS9 refinements, WS10 rest, WS11 rest, WS12 | Restore drill, crisis drill and load test pass on the new server |
| **5** | Launch (founder-led) | H tasks, closed test, staged rollout | Stop conditions in section 8 not hit |

Dependency rules that cannot be broken:

- T0.6 (PyJWT) before T3.1 and T3.2.
- T1.1 to T1.3 (compose, Caddy) before T5.10 (cutover) and before any WebSocket traffic on the new server.
- T11.1 (Maestro flows) before T6.2 (Expo upgrade).
- T6.2 (Expo 57) before T6.3 (native chat thread), so the thread is written once.
- T4.1 (job queue) before T2.4, T4.2, T4.3, T8.4.
- T2.1 (foreign keys) before T2.4 (retention partitions) and T5.6.
- T3.7 (member status) before T9.5 and before T5.2 checks the status on send.
- T8.2 (eval set tooling) before T8.3 and T8.4 can claim success.
- T5.5 (Stream removal) only after T5.9 (k6) and T11.3 pass on the new server.

## 6. Workstreams and task cards

### WS0 — Quick wins and repository hygiene (lane A, Wave 0)

**T0.1 Remove audio permissions and unused audio plugins** · S · deps: none
- Files: Modify `apps/mobile/app.json` (drop the four `RECORD_AUDIO` and `MODIFY_AUDIO_SETTINGS` lines and the `expo-audio` plugin), `apps/mobile/package.json` (remove `expo-audio`, `expo-av`).
- Accept: `npx expo config --type public` shows no audio permission; `expo-video` still works (`PlaygroundLoop.tsx`); web export passes.
- Verify: `npx tsc --noEmit`; `npx expo export --platform web`; grep the merged manifest after `npx expo prebuild --platform android --no-install` for `RECORD_AUDIO` (none).

**T0.2 Cleartext traffic only in development** · S · deps: T0.1
- Files: Create `apps/mobile/app.config.ts` that reads `app.json` and sets `usesCleartextTraffic` true only when `process.env.APP_VARIANT !== 'production'`; Modify `apps/mobile/eas.json` (production profile sets `APP_VARIANT=production`).
- Accept: production config has cleartext off; LAN development still works.
- Verify: `APP_VARIANT=production npx expo config --type public` shows `usesCleartextTraffic: false`.

**T0.3 Import icons by subpath** · S · deps: none
- Files: Create `apps/mobile/scripts/codemod-icons.mjs` (rewrites `import { Ionicons } from '@expo/vector-icons'` to `import Ionicons from '@expo/vector-icons/Ionicons'` in 77 files); Modify those files.
- Accept: `npx expo export --platform web` output lists only the Ionicons font; about 3.4 MB less.
- Verify: `npx tsc --noEmit`; compare `dist/assetmap.json` fonts before and after.

**T0.4 Remove unused Expo modules and the teleport patch** · M · deps: T0.1
- Files: Modify `apps/mobile/package.json`, delete `apps/mobile/patches/react-native-teleport*.patch` if the module is not a peer of anything left. Modules: `expo-media-library`, `expo-image-picker`, `expo-image-manipulator`, `expo-document-picker`, `expo-sharing`, `expo-clipboard`, `@react-native-community/datetimepicker`; check `expo-file-system`, `@react-native-community/netinfo`, `react-native-teleport` for peers first (they may belong to `stream-chat-expo` and go with T6.5).
- Accept: `tsc` and the web specs pass; no new permission appears in the merged manifest.

**T0.5 Drop unused server packages** · S · deps: none
- Files: Modify `services/api/requirements.txt` (remove `razorpay`, `posthog`); remove unused settings only if nothing reads them.
- Verify: full API verification commands.

**T0.6 Replace python-jose with PyJWT** · S · deps: none
- Files: Modify `services/api/requirements.txt` (replace `python-jose[cryptography]` with `PyJWT`), `services/api/app/security.py` (line 11 imports, `_decode` at line 79), `services/api/tests/test_security_hardening.py` (its `from jose import JWTError, jwt` import at the top becomes `import jwt` and `from jwt import PyJWTError as JWTError`); Create `services/api/tests/test_jwt_pyjwt.py`.
- Step 1, failing test (uses the real helpers `security._decode`, `get_settings()`):

```python
# services/api/tests/test_jwt_pyjwt.py
import jwt
import pytest
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from app import security
from app.config import get_settings


def _creds(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_existing_hs256_token_still_decodes():
    tok = jwt.encode({"sub": "u1", "role": "user", "iat": 1, "exp": 4102444800},
                     get_settings().jwt_secret, algorithm="HS256")
    assert security._decode(_creds(tok), "user")["sub"] == "u1"


def test_token_without_exp_is_rejected():
    tok = jwt.encode({"sub": "u1", "role": "user"}, get_settings().jwt_secret, algorithm="HS256")
    with pytest.raises(HTTPException) as err:
        security._decode(_creds(tok), "user")
    assert err.value.status_code == 401
```

- Step 2, swap the calls in `security.py`: `import jwt` and `from jwt import PyJWTError as JWTError`; keep `algorithms=[_ALGO]` on every decode; add `options={"require": ["exp", "iat", "sub"]}` to `jwt.decode`. Confirm `jwt.encode` returns `str` (PyJWT 2).
- Accept: existing tokens keep working (no forced logout); tokens without `exp` are refused.
- Verify: full API verification commands.

**T0.7 Bump FastAPI and SQLAlchemy** · M · deps: T0.6
- Files: Modify `services/api/requirements.txt` (`fastapi` to 0.141.x, `sqlalchemy` to 2.0.54); read each changelog.
- Accept: pytest, `alembic check` and the web specs pass unchanged.

**T0.8 Tooling and hygiene** · M · deps: none
- Files: Create `.pre-commit-config.yaml` (ruff, black, gitleaks), `.github/dependabot.yml` (pip, npm, github-actions), `.github/workflows/security.yml` (osv-scanner, Semgrep CE); Modify `.github/workflows/*.yml` (pin actions to commit SHAs); Modify `services/api/requirements-dev.txt` (`pytest-xdist`); Delete `deploy/deploy-console.sh`; remove the three unused Lottie requires in `apps/mobile/components/art/LottieTile.tsx` and their JSON files; move `docs/DEPLOYMENT.md` and `deploy/do-app.yaml` into `docs/archive/`; fix the drifted numbers in `CLAUDE.md`.
- Accept: `pre-commit run --all-files` clean; CI still passes.

**T0.9 Conductor setup** · S · deps: none (conductor)
- Files: Create `docs/superpowers/program/STATUS.md` with every card from this plan; create six lanes with `scripts/lanes/lane.ps1`; run `bash scripts/lanes/gate.sh full` for a baseline.

### WS1 — Balanced platform (lane B, Wave 1)

**T1.1 Compose split** · M · deps: none
- Files: Create `deploy/compose.base.yml`, `deploy/compose.local.yml`, `deploy/compose.prod.yml`, `deploy/test-parity.sh`; keep container names `mento-postgres` and `mento-redis` (the gate execs into them); keep `deploy/docker-compose.prod.yml` until the server move.
- Accept: `docker compose -f deploy/compose.base.yml -f deploy/compose.local.yml up -d --wait` starts Postgres, Valkey, API and Caddy; `deploy/test-parity.sh` diffs `docker compose config` of the two override sets and fails if anything differs beyond env values, published ports, memory and log limits, and hostnames.
- Verify: `bash deploy/test-parity.sh`; `bash scripts/lanes/gate.sh fast` against the local stack.

**T1.2 Limits and tuning** · S · deps: T1.1
- Files: Modify `deploy/compose.prod.yml`. Postgres `command:` flags: `max_connections=50`, `shared_buffers=512MB`, `effective_cache_size=1536MB`, `work_mem=8MB`, `maintenance_work_mem=128MB`, `random_page_cost=1.1`, `wal_compression=on`, `checkpoint_timeout=15min`, `max_wal_size=1GB`; `mem_limit` 1024m. Valkey `--save "" --appendonly no --maxmemory 128mb --maxmemory-policy volatile-lru`. API `ulimits: nofile: 65535`. Every service `logging: {driver: json-file, options: {max-size: 10m, max-file: "3"}}`.
- Accept: `docker compose ... config` shows every value; `docker stats` under a k6 run stays inside limits.

**T1.3 Caddy** · M · deps: T1.1
- Files: Create `deploy/caddy/Caddyfile`, `deploy/test-caddy.sh`; keep `deploy/nginx/` until cutover.

```caddyfile
{$API_HOST} {
    encode zstd gzip
    reverse_proxy api:8000 {
        transport http { read_timeout 3600s }
    }
}
{$APP_HOST} {
    root * /srv/web/current
    try_files {path} /index.html
    file_server
    handle /admin* { respond 404 }
}
{$ADMIN_HOST} {
    root * /srv/web/current
    handle /admin* { try_files {path} /index.html
        file_server }
    handle { redir /admin 302 }
}
```

- Accept: `test-caddy.sh` asserts the same host map that `test-nginx.sh` asserts today (`app/` 200, `app/onboarding` 200, `app/apply` 200, `app/admin` 404, `admin/admin` 200) plus a WebSocket upgrade through `api.`.
- Local hostnames: `app.mento.localhost`, `api.mento.localhost`, `admin.mento.localhost` with mkcert certificates; document the three Windows hosts-file lines in `docs/DEPLOYMENT_VPS.md`.

**T1.4 Local stack seeding and gate** · S · deps: T1.1
- Files: Modify `deploy/compose.local.yml` (profile `seed` running `python -m scripts.seed_listeners`), `scripts/lanes/gate.sh` (accepts `MENTO_WEB` and `MENTO_API`).
- Accept: `docker compose --profile seed run --rm seed` seeds listeners; the gate passes against `https://app.mento.localhost`.

**T1.5 Backups and restore drill** · M · deps: T1.1
- Files: Create `deploy/backup-restic.sh` (pg_dump with `--exclude-table-data=chat_messages` once that table exists, encrypted restic repo on Backblaze B2, every 6 hours), `deploy/restore-drill.sh` (restore the newest snapshot into a scratch database in the local stack, assert row counts per table, run `alembic check`, drop it); Modify `deploy/backup-postgres.sh` to call restic.
- Accept: a drill on the local stack passes; the repo password lives in SOPS, not in `services/api/.env`.

**T1.6 Monitoring** · S · deps: T1.1
- Files: Modify `deploy/compose.prod.yml` (Beszel agent, CrowdSec agent); Create `docs/runbooks/monitoring.md` listing the four UptimeRobot monitors (`/api/v1/health/crisis` alert on 503, `/api/v1/health/ready`, `https://app.<root>/`, disk over 80%) and the phone alert channel.

**T1.7 Error tracker [D6]** · M · deps: T1.1, H12
- Files: Modify `deploy/compose.prod.yml` (GlitchTip or Bugsink, own database in the existing Postgres, Valkey db index for GlitchTip), `services/api/.env.example`, `apps/mobile/.env.example` (DSNs). Set `autoSessionTracking: false` in `apps/mobile/components/AppProviders.native.tsx` and `AppProviders.tsx`.
- Accept: a forced error from the API and from the app appears in the tracker with request bodies stripped.

**T1.8 Secrets with SOPS and age** · S · deps: none
- Files: Create `.sops.yaml`, `deploy/secrets/prod.env.sops.yaml`, `deploy/decrypt-env.sh` (decrypts to a tmpfs file at deploy time); document key custody in `docs/DEPLOYMENT_VPS.md`.

**T1.9 Deploys** · L · deps: T1.1, T1.3
- Files: Create `.github/workflows/api-deploy.yml` (needs `api-ci`, then SSH with the forced-command key), `deploy/bluegreen.sh`; Modify `deploy/deploy.sh` (run `docker compose run --rm api alembic upgrade head` first, then `up -d --wait`; roll back by image tag), `services/api/docker-entrypoint.sh` (no migrations in the serving container), `services/api/Dockerfile` (HEALTHCHECK hits `/api/v1/health/ready`), `scripts/lanes/ship.sh` (source `deploy/domains.env` for the SSH target instead of the hard-coded address), `services/api/migrations/env.py` (`lock_timeout` 3 s).
- Accept: a deliberately broken migration fails the deploy and leaves the old containers serving; a good deploy has no failed health check during the swap.

**T1.10 Server move (ops agent with founder)** · M · deps: T1.1 to T1.9, H1, H10
- Steps: build the Balanced stack on the new 4 GB box, restore the newest backup, run the parity and restore drills, lower DNS expiry, switch, keep the old box for a week. Production step: needs founder approval.

### WS2 — Data hygiene and privacy (lane C)

**T2.1 Foreign keys with explicit delete rules** · L · deps: none
- Files: Create one Alembic revision under `services/api/migrations/versions/`; Modify `services/api/app/models/{conversation,request,journal,safety,moderation,push_token,contribution,listener_application}.py`. Add real foreign keys where columns are bare `String(36)`: `conversations.user_id`, `conversations.listener_id`, `conversation_requests.*`, `journal_entries.user_id`, `push_tokens.owner_id` (by owner kind, so use a check plus a deferred trigger or split columns), `contributions.user_id`. Detached rows keep `ondelete='SET NULL'` (`safety_flags.user_id`, `moderation_events.reporter_id`).
- Accept: orphan rows are rejected; `services/erasure.py` still passes its tests; `alembic check` clean.
- Test: `services/api/tests/test_foreign_keys.py` inserts an orphan and expects `IntegrityError`.

**T2.2 Missing indexes** · S · deps: none
- Files: One Alembic revision. Indexes: `conversations(user_id, created_at)`, `conversations(listener_id, status)`, `conversation_requests(target_listener_id, status)`, `journal_entries(user_id, created_at)`, `mentor_links(user_id, status)`.
- Verify: `EXPLAIN` on the My Chats, console list and inbox queries uses them (assert in a test with `pg_indexes`).

**T2.3 Bound unbounded queries** · M · deps: none
- Files: Modify `services/api/app/routers/listeners.py:81-99` (limit and cursor), `routers/listener_console.py` (requests inbox: paging, and remove the `seen_at` write from GET into a POST), `routers/in_touch.py:164-172`; Modify `apps/mobile/lib/api.ts`, `lib/listenerApi.ts` to send paging.
- Accept: each endpoint takes `limit` (default 50, max 200) and `cursor`; tests cover three pages.

**T2.4 Retention purges** · M · deps: T4.1, T2.1
- Files: Create `services/api/app/jobs/retention.py` (periodic jobs), config constants in `app/config.py` (`retain_safety_flags_days`, `retain_moderation_days`, `retain_feedback_days`, `retain_name_history_days`); Test: `tests/test_retention.py`.
- Accept: rows older than the window are deleted, newer rows stay, ended conversations follow the message retention; `docs/PRIVACY.md` states the numbers (T10.6).

**T2.5 Data export** · S · deps: none
- Files: Modify `services/api/app/routers/me.py` (`GET /me/export` returns one JSON of the member's own rows, using the table inventory in `services/erasure.py`); Test: `tests/test_export.py` asserts no other member's data and no message text of others.

**T2.6 Erasure after Stream removal** · M · deps: T5.5
- Files: Modify `services/api/app/services/erasure.py` (drop Stream phases, delete `chat_messages` for the member's conversations, keep the three-phase structure and the 503-not-lie behaviour); Test: extend `tests/test_erasure.py`.

**T2.7 Data request and grievance tables** · S · deps: none
- Files: Create `services/api/app/models/data_request.py` (`data_requests`: kind, status, opened_at, due_at, closed_at; no identity) and a revision; used by T9.11.

**T2.8 Push token cleanup by role** · S · deps: none
- Files: Modify `services/api/app/services/push.py:196-199` (delete by token and owner kind); Test: add to `tests/test_push.py` that a dead member token leaves the listener row.

**T2.9 Name rotation without table scans** · M · deps: T4.1
- Files: Modify `services/api/app/services/mentor_names.py` (indexed lookups, remove whole-table reads inside the advisory lock); Test: existing name tests plus a query-count assertion.

### WS3 — Auth and abuse (lane D)

**T3.1 Token claims and secrets** · M · deps: T0.6
- Files: Modify `services/api/app/security.py`, `app/config.py` (`listener_jwt_secret`, `iss`, `aud`), `app/main.py` (boot invariant: listener secret set and different from the member secret outside dev; `TRUSTED_PROXY_HOPS` must be set outside dev); Test: `tests/test_security_hardening.py`.
- Accept: new tokens carry `iss`, `aud`, `jti`; old tokens without them still decode until the date in the comment; listener tokens signed with their own secret; the role-less window closes on 2026-10-17 as already commented.

**T3.2 Sessions and refresh tokens** · L · deps: T3.1
- Files: Create `services/api/app/models/session.py` (`sessions`: id, user_id, family_id, jti, device_id, rotated_from, created_at, expires_at, revoked_at), `app/services/sessions.py`, `app/routers/auth.py` (`POST /auth/refresh`, `POST /auth/upgrade`), revision; Modify `app/security.py` (15-minute access tokens), `app/main.py`; Client: `apps/mobile/lib/api.ts`, `lib/session.ts` (store the pair, refresh on 401 once, then fall back to the old behaviour). Test: `tests/test_sessions.py`.
- Step 1, failing test for reuse detection:

```python
# services/api/tests/test_sessions.py
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models.user import User
from app.security import issue_session_token

from .conftest import TestSession, requires_postgres


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def member_headers():
    with TestSession() as s:
        u = User(persona_name="Quiet Cove", persona_avatar="x", dob=date(1996, 1, 1), age_at_signup=30)
        s.add(u)
        s.commit()
        uid = u.id
    return {"Authorization": f"Bearer {issue_session_token(uid)}"}


@requires_postgres
def test_reused_refresh_token_kills_the_family(client, member_headers):
    first = client.post("/api/v1/auth/upgrade", headers=member_headers).json()
    rotated = client.post("/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]}).json()
    assert rotated["refresh_token"] != first["refresh_token"]
    # presenting the OLD refresh token again is theft: everything in the family dies
    again = client.post("/api/v1/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert again.status_code == 401
    after = client.post("/api/v1/auth/refresh", json={"refresh_token": rotated["refresh_token"]})
    assert after.status_code == 401
```

- Accept: refresh tokens are stored hashed; a 90-day-old client that calls any endpoint still works and upgrades silently; `e2e/role-fork.e2e.js` and `e2e/member-screens.e2e.js` pass with no forced logout.

**T3.3 Legacy token exit** · S · deps: T3.2
- Files: Modify `services/api/app/security.py` (remove the `None`-role branch and the missing-claim leniency on the dates written in the comments); Test: expired-leniency tests flip to rejections.

**T3.4 Play Integrity and proof-of-work at signup** · M · deps: T3.2, H3
- Files: Create `services/api/app/services/integrity.py` (verifies the Play Integrity token with a Google service account; a fake verifier for tests), `app/services/pow.py` (hashcash challenge, difficulty from config); Modify `app/routers/onboarding.py` (challenge endpoint plus verification behind `integrity_enforced`), `app/config.py`; Client: `apps/mobile/lib/api.ts`, onboarding step. Test: `tests/test_pow.py`, `tests/test_integrity.py`.
- Accept: with enforcement on, a signup without a valid challenge is refused; with it off nothing changes; the public `/apply` page path uses the proof-of-work only.

**T3.5 Recovery phrase** · M · deps: T3.2
- Files: Modify `services/api/app/models/user.py` (`recovery_hash`), revision, `app/routers/me.py` (`POST /me/recovery`, returns the phrase once), `app/routers/onboarding.py` (`POST /onboarding/recover`); use `argon2-cffi`; Client: a Profile card `apps/mobile/components/profile/RecoveryCard.tsx` with the copy "Mento will never ask you for this"; locales `en.json` and `hi.json`. Test: `tests/test_recovery.py`.
- Accept: only a hash is stored; recovery mints a new session and revokes the old family; rate-limited and fail-closed.

**T3.6 Device-bound keys** · L · deps: T3.2, T6.2
- Files: Create `services/api/app/models/device_key.py`, `app/services/device_keys.py` (register a P-256 public key, verify a signed server nonce); Client: `apps/mobile/lib/deviceKey.ts` (hardware-backed key via the platform keystore; needs a development build).
- Accept: with keys on, a stolen access token is useless without the signature; off by default behind `device_keys_enabled`.

**T3.7 Member status, ban and re-join signal** · L · deps: T3.1
- Files: Modify `services/api/app/models/user.py` (`status`, `banned_until`, `install_hash`), revision; Modify `app/security.py` (`current_user_id` refuses suspended and banned), `app/routers/match.py`, `app/routers/conversation.py`; Create `app/services/member_status.py` (suspend, ban, lift, all audited via `app/services/audit.py`); the send path check lands in T5.2. Test: `tests/test_member_ban.py` (banned member cannot match; a new account from the same install hash is flagged).
- Accept: `ModerationLevel.suspension` and `ban` finally act.

**T3.8 Age-gate friction** · S · deps: none
- Files: Modify `services/api/app/routers/onboarding.py` (Redis cooldown keyed by IP and install hash after a 403), `apps/mobile/components/mentorPath/AgeGateStep.tsx` (remove the pre-filled "exactly 18" default at line 34; remember a refusal on the device); locales; Test: extend `tests/test_security_hardening.py`.

**T3.9 Terms gate** · M · deps: none
- Files: Modify `services/api/app/models/user.py` (`terms_accepted_at`), revision, `app/routers/onboarding.py`, `app/routers/match.py` (no match before acceptance), `apps/mobile/components/onboarding/steps/` (new `TermsStep.tsx`), locales, `apps/mobile/e2e/onboarding-terms.e2e.js`.
- Accept: a first message cannot be sent without an acceptance timestamp.

**T3.10 One-time mentor console links** · M · deps: T3.1
- Files: Modify `services/api/app/routers/listener_applications.py` (`_out()` at lines 36-47 stops minting a token on every poll; add `POST /listener-applications/me/console-code` returning a 10-minute single-use code and `POST /listener/session/exchange`), `app/services/links.py`, `apps/mobile/components/listener/ListenerConsole.web.tsx`, `lib/listenerApi.ts`. Test: `tests/test_console_codes.py`.

**T3.11 Onboarding rate limit fails closed** · S · deps: none
- Files: Modify `services/api/app/ratelimit.py`, `app/routers/onboarding.py` (use `fail_closed=True`); Test: Redis down returns 503 for signup and still allows chat sends.

**T3.12 Scope admin conversation reads** · M · deps: T9.1
- Files: Modify `services/api/app/routers/admin_console.py:233-248` (require an open flag or report for that conversation and a reason string; write the reason into the audit row); Test: `tests/test_admin_scope.py`.

### WS4 — Job queue (lane E)

**T4.1 Procrastinate** · L · deps: T0.7
- Files: Modify `services/api/requirements.txt` (`procrastinate[psycopg]`); Create `services/api/app/jobs/__init__.py` (app object using the sync psycopg connector), `app/jobs/worker.py`, a revision that installs the Procrastinate schema through Alembic, a `worker` service in `deploy/compose.base.yml`; Test: `tests/test_jobs.py` (a job enqueued in the same transaction as data; a failed job stays queryable).
- Accept: a job enqueued inside a database transaction runs after commit and is not lost by an API restart.

**T4.2 Move pushes to jobs** · M · deps: T4.1
- Files: Modify `services/api/app/services/push_tasks.py`, `app/services/push.py` (retry with backoff; remove the blocking sleep), callers in `routers/listeners.py`, `routers/listener_console.py`, and the chat send path later; Test: `tests/test_push.py` extended.

**T4.3 Move sweeps and rotation to periodic jobs** · M · deps: T4.1
- Files: Modify `services/api/app/services/matching.py` (`sweep_stale_presence`, `reconcile_listener_capacity` become periodic jobs every 5 minutes, keep the inline fallback), `app/services/mentor_names.py` (04:00 IST job), `app/services/snooze.py`, crisis-exempt tally; Test: each job idempotent.

**T4.4 Job health in admin** · S · deps: T4.1
- Files: Modify `services/api/app/routers/admin_console.py` (`/admin/health/deep` reports queue depth and failed jobs).

### WS5 — Own chat, server (lane F; base is branch `spike/own-chat`)

**T5.1 Bring the spike into master** · L · deps: T1.2, T4.1
- Files: From `spike/own-chat` create `services/api/app/models/chat_message.py` (`chat_messages`: id, conversation_id FK cascade, seq, client_id, sender_kind, sender_id, body encrypted, created_at; `chat_read_markers`), a revision, `app/services/chat.py`, `app/chat_hub.py`, `app/routers/chat.py`; rebuild the tests as `tests/test_chat_*.py` (ten tests from the spike, adapted).
- Accept: the spike's ten tests pass on master; two uvicorn workers deliver across workers over Valkey.

**T5.2 One write path** · L · deps: T5.1, T3.7, T8.5
- Files: Modify `services/api/app/services/chat.py` so `send()` does, in this order and nowhere else: member status check → crisis scan → allowance (skipped for flagged messages) → redaction → insert with `seq` → commit → publish → enqueue jobs. Test: `tests/test_chat_write_path.py`.

`chat.py` exposes module-level `scan_message(text)` and `persist_message(...)`, which the tests patch. `db_session` is the fixture in `tests/conftest.py`; `seed_conversation` is a small helper in the test file that creates a member, a mentor and an active conversation the way `tests/test_security_hardening.py` does with `_seed_user` and `_seed_listener`.

```python
# services/api/tests/test_chat_write_path.py
from sqlalchemy import select

from app.models.safety import SafetyFlag
from app.services import chat


def test_scan_runs_before_persist(monkeypatch, db_session):
    member, conv = seed_conversation(db_session)
    order: list[str] = []
    monkeypatch.setattr(chat, "scan_message", lambda text: order.append("scan") or None)
    monkeypatch.setattr(chat, "persist_message", lambda *a, **k: order.append("persist") or 1)
    chat.send(db_session, member.id, conv.id, client_id="c1", body="hello")
    assert order == ["scan", "persist"]


def test_flagged_message_stores_signal_not_text(db_session):
    member, conv = seed_conversation(db_session)
    chat.send(db_session, member.id, conv.id, client_id="c2", body="I want to end my life")
    flag = db_session.execute(select(SafetyFlag)).scalar_one()
    assert flag.signal.value in ("suicidal", "self_harm")
    assert "end my life" not in (flag.matched_terms or "")
```

- Accept: there is no second write path (grep `INSERT` and `.add(ChatMessage` shows one site); a crisis message is never held or counted by the allowance.

**T5.3 Hardening** · L · deps: T5.1
- Files: Modify `services/api/app/routers/chat.py` and `app/chat_hub.py`: per-socket rate limit (reuse `ratelimit.allow` keyed `chat:{user}`), `--ws-max-size` 16 KB, ping deadline and close on missed pings, bounded per-socket send queue that drops the socket on overflow, a cap of sockets per user per conversation; `app/db.py` (`statement_timeout` 5 s, pool 10 plus 10 per worker); collapse the three `_db()` calls in the hello frame into one; merge the commits inside `allowance.register`.
- Accept: tests for each limit; a slow client cannot stall a room.

**T5.4 Presence, typing, read state, ended events, reconnect** · M · deps: T5.1
- Files: Modify `services/api/app/chat_hub.py`, `app/services/conversations.py` (end path publishes `ended` and closes sockets; Clean Wipe deletes and publishes `wiped`); Test: `tests/test_chat_lifecycle.py` (reconnect gets exactly the missed messages after `seq`).

**T5.5 Remove Stream from the server** · L · deps: T5.9, T11.3, T2.6
- Files: Delete `services/api/app/services/stream.py`, `app/routers/stream_hooks.py`, `services/api/scripts/configure_stream.py`, `.claude/skills/mento-crisis-webhook/`; Modify `app/main.py` (drop the Stream boot invariant and router), `app/routers/onboarding.py` (no Stream upsert or rollback), `app/services/matching.py`, `app/services/conversations.py`, `app/routers/health.py` (`/health/crisis` now checks a heartbeat stamped by `chat.send`), `app/config.py`, `.env.example`, `requirements.txt` (`stream-chat`); revision renaming `stream_channel_id` to `channel_ref`; keep the column name working during the cutover.
- Accept: no import of `stream_chat` remains; the pytest suite passes without Stream credentials; the crisis-health check goes stale within 30 minutes if no message is scanned and fires the alert.

**T5.6 Message retention and encryption at rest** · L · deps: T2.1, T5.1
- Files: Create a revision converting `chat_messages` to monthly range partitions; `app/services/message_crypto.py` (AES-GCM, key from `MESSAGE_KEY` with a key id so keys can rotate); `app/jobs/retention.py` drops old partitions per the founder's retention number (H13). Test: `tests/test_message_crypto.py`.
- Accept: a database dump without the key shows only ciphertext; dropping a partition removes its messages.

**T5.7 Push watching through the hub** · S · deps: T5.1, T7.1
- Files: Modify `services/api/app/services/push.py` (`_is_watching` uses `hub.is_connected`).

**T5.8 Admin conversation window** · M · deps: T5.1, T9.2
- Files: Modify `services/api/app/services/chat.py` (`history_window(conversation_id, around_seq, n)` returns decrypted redacted text), used by the safety desk only.

**T5.9 Load test** · M · deps: T5.3, T1.10
- Files: Create `scripts/loadtest/chat.js` (k6 WebSocket scenario, 100 chats, 3 messages per second, reconnect storm), `docs/superpowers/spikes/chat-loadtest.md` with results.
- Accept: send-to-delivered p95 under 500 ms at target load on the real server; nothing lost or duplicated.

**T5.10 Cutover** · L · deps: T5.5, T6.3, T6.4, H8
- Files: Create `docs/runbooks/chat-cutover.md`, feature flag `chat_backend` (`stream` or `own`) read at signup and match; script `services/api/scripts/end_open_conversations.py` (ends about 30 open conversations with an honest closing message).
- Accept: rehearsed on the local stack and on the new server; rollback is one flag flip until the Stream removal is released.

### WS6 — Mobile (lane G upgrade, lane H chat)

**T6.1 Maestro flows** · M · deps: none
- Files: Create `apps/mobile/e2e/maestro/onboarding-first-message.yaml`, `two-party-chat.yaml`, `crisis-card.yaml`, `apps/mobile/e2e/maestro/README.md`, `.github/workflows/maestro.yml` (Linux runner with `reactivecircus/android-emulator-runner`); a helper `apps/mobile/e2e/maestro/mentor-bot.mjs` that answers as the mentor through the API.
- Accept: the three flows pass on an emulator against SDK 52 before any upgrade.

**T6.2 Expo upgrade chain 52 to 57** · L (one card per step, five cards) · deps: T6.1
- Files: `apps/mobile/package.json`, `app.json`, `eas.json`, `babel.config.js`, `patches/`, `.npmrc`, code where the changelog demands. Steps in order, each committed and gated on its own: 53, 54 (edge-to-edge: re-walk every `useSafeAreaInsets` gotcha in `CLAUDE.md`, `PandaStage`, `LineSheet`), 55, 56 (icons to `@react-native-vector-icons/ionicons`, expo-router codemod), 57 (Reanimated 4 with `react-native-worklets`, retune `spring.calm`, Skia 2 with the aurora shader re-verified, Lottie 7.5, Sentry 8).
- Accept per step: `npx expo-doctor` clean, `tsc` clean, web specs pass, Maestro flows pass; after 54 `targetSdkVersion` reads 36 in the prebuilt Gradle files and the 16 KB page-size check passes in Play's bundle explorer.
- Stop rule: if a step fails the gate for more than a day, stop and report to the conductor.

**T6.3 Own chat thread on native** · L · deps: T6.2, T5.4
- Files: Create `apps/mobile/components/chat/ChatThread.tsx` (shared, FlatList first, `react-native-keyboard-controller`'s `KeyboardChatScrollView`), `apps/mobile/lib/chatSocket.ts` (first-frame auth, jittered reconnect, `after=seq` catch-up, `client_id` exactly-once), `apps/mobile/lib/outbox.ts` (unsent messages in `expo-sqlite`, deleted by `forgetConversation()`); Modify `ChatScreen.tsx`, `mentor/MentorChatScreen.tsx`; reuse `ThreadRow.tsx`, `Composer.tsx`, `MessageText.tsx`, `CrisisCard.tsx`.
- Accept: the native thread matches the web thread's geometry with no kit overrides; Maestro `two-party-chat.yaml` and `crisis-card.yaml` pass; airplane-mode send queues and delivers once on reconnect.

**T6.4 Web threads on the new protocol** · M · deps: T5.4
- Files: Modify `apps/mobile/components/chat/ChatScreen.web.tsx`, `mentor/MentorChatScreen.web.tsx`; Test: `e2e/two-party-chat.e2e.js` keeps passing.

**T6.5 Remove the Stream client** · M · deps: T6.3, T6.4
- Files: Delete `apps/mobile/lib/streamClient.ts`, `lib/listenerStreamClient.ts`, `components/chat/{KitMessageFooter,KitSavedHeader,KitTyping,bubbleWidth}.ts*`, `patches/stream-chat-expo*.patch`; Modify `apps/mobile/package.json` (remove `stream-chat`, `stream-chat-expo`, `react-native-teleport`, `netinfo` if unused), `.npmrc` (drop `legacy-peer-deps` if nothing needs it), `components/AppProviders*.tsx`, `lib/session.ts`.
- Accept: the app boots with no Stream code; bundle shrinks (record the number).

**T6.6 App Links** · S · deps: T1.3
- Files: Modify `apps/mobile/app.json` (`intentFilters` with `autoVerify`), Caddy site block serving `/.well-known/assetlinks.json` from `deploy/site/`; document the SHA-256 source (Play App Signing).

**T6.7 Size and start-up** · M · deps: T6.2
- Files: Modify `apps/mobile/app.json` and `eas.json` (`enableMinifyInReleaseBuilds`, `enableShrinkResourcesInReleaseBuilds`, arm64-only for the APK track), `theme/` font loading (three Baloo weights), re-encode `assets/scenes/playground-loop.mp4`, lazy-load `locales/hi.json`.
- Accept: release size recorded before and after; cold start measured with Flashlight on a mid-range Android device (H9).

**T6.8 Offline journals** · L · deps: T6.3
- Files: Create `apps/mobile/lib/journalStore.ts` (`expo-sqlite` with SQLCipher), wire `app/(tabs)/journals.tsx` and `app/journal/*`; wipe on Start fresh.
- Accept: journals open with no network.

**T6.9 Skia fallback for low-RAM devices** · S · deps: T6.7
- Files: Modify `apps/mobile/components/motion/AmbientBackground.tsx` (serve `StaticAmbient` under a device-tier check).

### WS7 — Push (lane I)

**T7.1 FCM v1 sender** · M · deps: T4.2
- Files: Create `services/api/app/services/push_fcm.py` (service-account OAuth token cached, `httpx` POST to FCM v1); Modify `app/services/push.py` (`EXPO_PUSH_URL` becomes a setting; route by `token_type`); `app/models/push_token.py` (`token_type` column, revision); Test: `tests/test_push.py` with a fake FCM server.

**T7.2 Client device tokens** · M · deps: T7.1, T6.2
- Files: Modify `apps/mobile/lib/pushNotifications.ts` (`getDevicePushTokenAsync`; create the Android channel before requesting the token), `lib/api.ts`, `lib/listenerApi.ts`.

**T7.3 Data-only payloads [D10]** · S · deps: T7.2
- Files: Modify `services/api/app/services/push.py`, `apps/mobile/lib/notifications.ts` (compose the persona line on the phone); keep `PUSH_ENABLED`, burst window and watching suppression unchanged.
- Accept: notification arrives with the app killed on a mid-range phone (H9).

**T7.4 Remove the Expo relay** · S · deps: T7.3
- Files: delete `exp.host` calls and Expo-token handling after a migration window.

### WS8 — Safety tools (lane J)

**T8.1 Versioned lexicon** · M · deps: none
- Files: Create `services/api/app/data/crisis_lexicon.json` (terms, language, script, category, added_at, version), `app/services/crisis_lexicon.py` (loader); Modify `app/services/crisis.py` (use the loader); Test: `tests/test_crisis_lexicon.py` (every term fires; an English near-miss list does not).
- Accept: behaviour identical to today's regexes on the current test suite.

**T8.2 Eval tooling** · M · deps: none
- Files: Create `scripts/safety_eval/schema.md` (CSV: id, text, language, script, label, oblique), `scripts/safety_eval/run.py` (scores any lane, prints recall, precision, false-positive rate, and the oblique subset), `scripts/safety_eval/README.md`. The dataset is written by mentors (H7) and never taken from real chats.

**T8.3 Phrase-bank lane** · M · deps: T8.1, T8.2
- Files: Create `services/api/app/services/crisis_semantic.py` (in-process all-MiniLM-L6-v2 embeddings, cosine against a curated phrase bank, 150 ms hard timeout, fail-open), `requirements-ml.txt` entry, `app/data/phrase_bank.json`.
- Accept: an OR with the lexicon; ships only if it beats the lexicon on the eval set's Hinglish and oblique subsets.

**T8.4 Guard-model trial** · L · deps: T4.1, T8.2, T1.10
- Files: Create `services/api/app/jobs/guard_scan.py` (Qwen3Guard-0.6B or PolyGuard via llama.cpp in the worker, asynchronous on every message, adds a flag and a category and severity hint only), `app/services/crisis_guard.py`; behind `guard_enabled`.
- Accept: measured against the eval set before the flag is turned on; a model timeout never blocks a send.

**T8.5 Signal storage** · S · deps: none
- Files: Modify `services/api/app/models/safety.py` (`category`, `risk_score`, `source`), revision, `app/services/safety.py`; never store text.

**T8.6 Sensitive-data signals** · M · deps: T8.5
- Files: Modify `services/api/app/services/moderation.py` (patterns for Aadhaar, PAN, UPI IDs, social handles, addresses), Create `app/models/sensitive_event.py` (`conversation_id`, `kind`, `count`, `first_at`, `last_at`; no text) and a revision; Test: `tests/test_sensitive_events.py`.

**T8.7 Mentor-misconduct rule** · S · deps: T8.6
- Files: Modify `services/api/app/services/moderation.py` (a mentor message asking for contact or to move off-app raises a high-severity signal and warns the mentor); Test: `tests/test_mentor_contact_rule.py`.

**T8.8 Crisis card that keeps the mentor in the room** · M · deps: none
- Files: Modify `apps/mobile/components/chat/CrisisCard.tsx`, `components/mentor/HelplinesSheet.tsx`, `locales/en.json`, `locales/hi.json` (copy lowers the barrier to a helpline while the mentor stays in the conversation); helplines carry a last-verified date in `app/config.py`. Test: `e2e/crisis-card.e2e.js`.
- Founder review of the copy is required before merge (H11).

**T8.9 Crisis-health wiring** · S · deps: T1.6
- Files: Modify `docs/runbooks/crisis-scan-dead.md`; add a chaos test that stops scanning and expects `/health/crisis` to return 503 within the window.

**T8.10 Crisis drill** · S · deps: T8.3
- Files: Create `scripts/safety_eval/drill.py` (sends the seeded set through the real path on the staging stack, asserts every message flags).

### WS9 — Admin panel (lane K backend, lane L UI)

**T9.1 Roles, two-factor, approvals, audit search** · L · deps: T3.1
- Files: Modify `services/api/app/models/admin.py` (`role` enum: owner, safety_lead, moderator, support, read_only; `totp_secret`), Create `app/models/admin_approval.py`, revision, `app/services/permissions.py` (permission map), `app/services/approvals.py` (a sensitive action needs a second admin's approval), Modify `app/routers/admin_console.py` (audit search and export endpoints); use `pyotp`; Test: `tests/test_admin_roles.py`, `tests/test_admin_approvals.py`.

**T9.2 Safety desk backend** · L · deps: T9.1, T8.5
- Files: Create `services/api/app/routers/admin_safety.py`: queue ranked by severity, claim, close with outcome code, SLA timers, `POST /admin/safety/{flag}/window` (reason required, time-limited, returns the flagged window from `chat.history_window`), private message to the mentor; every call audited. Test: `tests/test_admin_safety_desk.py`.

**T9.3 Safety desk UI** · L · deps: T9.2
- Files: Create `apps/mobile/components/admin/panels/SafetyDeskPanel.web.tsx`; Modify `lib/adminApi.ts`, `components/admin/AdminConsole.web.tsx`; Test: `apps/mobile/e2e/admin-safety-desk.e2e.js`.

**T9.4 Sensitive-data panel** · M · deps: T8.6, T9.3
- Files: Create `services/api/app/routers/admin_sensitive.py`, `components/admin/panels/SensitivePanel.web.tsx`.

**T9.5 Member management** · L · deps: T3.7, T9.1
- Files: Create `services/api/app/routers/admin_members.py` (search by persona only, statuses with end dates, report history, install-hash links, suspend, ban and lift with reasons, audited), `components/admin/panels/MembersPanel.web.tsx`.

**T9.6 Mentor upgrades** · L · deps: T9.1
- Files: Modify `services/api/app/routers/admin_console.py` (mentor applications checklist and notes), Create `admin_coverage.py` (online hours by hour, gaps, silent-mentor alerts), `components/admin/panels/MentorsPanel.web.tsx`.

**T9.7 Paging for reports, flags, applications** · M · deps: T2.3
- Files: Modify `services/api/app/routers/admin_console.py:167,263,528,773,845` (cursor paging, totals), the matching panels.

**T9.8 Rules and content editor** · L · deps: T8.1, T8.2, T9.1
- Files: Create `services/api/app/models/rule_version.py`, `app/routers/admin_rules.py` (draft, test against the eval set, approve by a second admin, publish, roll back; covers lexicon, phrase bank, helplines and coaching cards), `components/admin/panels/RulesPanel.web.tsx`.
- Accept: no rule reaches production without two approvals and a passing test run.

**T9.9 Events table and insights** · L · deps: T9.1
- Files: Create `services/api/app/models/analytics_event.py`, `app/routers/analytics.py` (`POST /analytics/capture`, closed event list, no user id), `app/routers/admin_insights.py` (funnel, time to first reply, coverage by hour, topics with k of 10, aggregate reflections), `components/admin/panels/InsightsPanel.web.tsx`; Modify `apps/mobile/lib/analytics.ts` to post to our API and add the analytics opt-out.

**T9.10 System panel and switches** · M · deps: T4.4, T1.5
- Files: Create `services/api/app/models/feature_switch.py`, `app/routers/admin_system.py` (backup last success and restore-drill result read from `/var/lib/mento/status.json` written by the scripts, queue depth, deploy history, switches for allowance, push, maintenance banner), `components/admin/panels/SystemPanel.web.tsx`.

**T9.11 Privacy and data requests** · M · deps: T2.5, T2.7
- Files: Create `services/api/app/routers/admin_privacy.py` (request tracker with 90-day timers, grievance log, retention job status), `components/admin/panels/PrivacyPanel.web.tsx`.

**T9.12 Team and access UI** · M · deps: T9.1
- Files: Create `components/admin/panels/TeamPanel.web.tsx` (roles, two-factor setup, session list and revoke, weekly conversation-view digest).

**T9.13 Announcements** · S · deps: T9.10
- Files: Create `services/api/app/routers/admin_announce.py`, a maintenance banner read by the app at `GET /status`.

**T9.14 Admin end-to-end specs** · M · deps: T9.3 to T9.13
- Files: Create `apps/mobile/e2e/admin-*.e2e.js` (one per panel), update `e2e/README.md`.

### WS10 — Store and legal readiness (lane M)

**T10.1 Public pages** · M · deps: T1.3
- Files: Create `deploy/site/privacy/index.html`, `terms/index.html`, `delete/index.html`, `child-safety/index.html` generated from `docs/PRIVACY.md` and new docs by `scripts/build_legal_site.py`; served by Caddy on the app host.
- Accept: each opens without an account; the delete page names the app and developer and starts the same erasure as `DELETE /me`.

**T10.2 In-app trust surface** · M · deps: T10.1
- Files: Modify `apps/mobile/app/(tabs)/profile.tsx` (links to the four pages, analytics opt-out, notifications opt-out), `app/start-fresh.tsx` (label "Delete my account and data"), locales; Test: `e2e/member-screens.e2e.js`.

**T10.3 Copy lint** · S · deps: none
- Files: Create `scripts/copy_lint.py` (fails on banned words in `locales/*.json`, store listing files and docs under `docs/store/`); add to `scripts/lanes/gate.sh`.

**T10.4 Store forms and listing** · M · deps: T10.1
- Files: Create `docs/store/DATA_SAFETY.md` (every SDK and data item), `docs/store/LISTING.md` (description with the exact "not a medical device and does not diagnose, treat, cure or prevent any medical condition" sentence and the consult-a-professional line), `docs/store/REVIEW_NOTES.md` (anonymous flow, mentor-online path, moderation and filtering, contact), `docs/store/CHILD_SAFETY.md`.

**T10.5 Privacy policy rewrite [D2, D1]** · M · deps: T5.6, T2.4
- Files: Modify `docs/PRIVACY.md`: message bodies in our database, retention numbers, backups exclude bodies, staff visibility level, Gemini consent string and cross-border note, sub-processor list, grievance contact, DPDP items. Founder and counsel sign-off (H6).

**T10.6 Privacy manifest for later iOS** · S · deps: T6.2
- Files: Create `apps/mobile/ios/PrivacyInfo.xcprivacy` template documented in `docs/store/IOS_LATER.md` (not built now).

### WS11 — Quality (lane N)

**T11.1** Maestro flows in CI, covered in T6.1 (owner: lane G).

**T11.2 Schemathesis job** · S · deps: T0.7
- Files: Modify `.github/workflows/api-ci.yml` (separate non-blocking job running Schemathesis against the OpenAPI in-process).

**T11.3 Chaos and failure drills** · M · deps: T5.3
- Files: Create `services/api/tests/chaos/` (Valkey down, Postgres slow, API restart mid-message, worker down) and `docs/runbooks/failure-drills.md`.
- Accept: each failure has the documented behaviour (fail-open with an alert for the scan, fail-closed for signup, no lost or duplicated messages).

**T11.4 Accessibility checks** · S · deps: none
- Files: Modify two or three `apps/mobile/e2e/*.e2e.js` to run `@axe-core/playwright`.

**T11.5 Gate update** · M · deps: T1.4
- Files: Modify `scripts/lanes/gate.sh` (containerised local stack, new specs, copy lint, restore drill monthly in the full tier).

**T11.6 Restore drill automation** · S · deps: T1.5
- Files: Modify `.github/workflows/` scheduled workflow that runs `deploy/restore-drill.sh` against a fresh Postgres service and fails on mismatch.

### WS12 — Documentation and handover (lane O)

**T12.1 Runbooks** · M · deps: T1.9
- Files: Create `docs/runbooks/{deploy,rollback,restore,rotate-secrets,incident,mentor-coverage,crisis-scan-dead,chat-cutover,failure-drills,monitoring}.md`.

**T12.2 Project memory** · S · deps: each wave
- Files: Modify `CLAUDE.md` (stack table: remove Stream, Expo push relay and PostHog; add Caddy, Valkey, Procrastinate, FCM, GlitchTip; fix counts), `PROGRESS.md` (per session), `docs/DECISIONS.md` (new section recording D1 to D4 and the staff-visibility choice), `.claude/skills/mento-stack/SKILL.md` and `mento-verify/SKILL.md` (new run and verify commands).

### WS13 — Art pipeline (lane P, optional, low priority)

**T13.1 Open-model art pipeline** · M · deps: none
- Files: Create `scripts/companions/comfyui.md` (ComfyUI with Qwen-Image-Edit, licence rules: no non-commercial weights, no `rembg` default model), keep `cutout.py`; record Higgsfield output-rights terms in `docs/mascot-candidates/README.md` (H14).

## 7. Founder-only tasks

| ID | Task | Needed by |
|---|---|---|
| H1 | Order the 4 GB plan in India (Hostinger KVM 1 or DigitalOcean BLR1) | before T1.10 |
| H2 | Start the organisation store account (D-U-N-S number), pay the Google Play fee | Week 0 |
| H3 | Create the Google Cloud project and service account for Play Integrity and FCM; put keys in SOPS | before T3.4, T7.1 |
| H4 | Backblaze B2 account and bucket; UptimeRobot account; phone alert channel | before T1.5, T1.6 |
| H5 | GitHub secrets and the deploy-only SSH key | before T1.9 |
| H6 | Legal and privacy review of the policy, terms and child-safety page; name the grievance officer; create `support@` and `grievance@` | before T10.5 |
| H7 | Write the Hinglish crisis eval set with senior mentors (a few hundred labelled messages, including oblique ones) | before T8.3 claims success |
| H8 | Recruit 12 or more testers and the pilot mentor cohort; staff coverage hours for review and launch week | Week 0 onward |
| H9 | A mid-range Android phone for push, cold-start and Flashlight checks | before T6.7, T7.3 |
| H10 | DNS changes and short expiry for the server move | at T1.10 |
| H11 | Approve the crisis card copy and the mentor coaching cards | before T8.8 merges |
| H12 | Check the GlitchTip and Bugsink licences and choose one | before T1.7 |
| H13 | Choose the message retention number (30, 60 or 90 days) and the chat-backup option | before T5.6 |
| H14 | Record Higgsfield's output-rights terms | before store submission |
| H15 | Store consoles: content rating, target audience 18+, Restrict Minor Access, health declaration, data safety, app access notes, closed-test setup | before Wave 5 |

## 8. Gates, launch checks and stop conditions

Wave gates are in section 5. Launch gates (all must pass): scan-before-store proven on the only write path; seeded English, Hindi and Hinglish crisis set fully flagged by `scripts/safety_eval/drill.py`; `/health/crisis` pages the founder's phone; policy, terms, deletion and child-safety pages live and matching the store forms; backups exclude wiped chats and a restore drill passed; k6 on the real server holds p95 under 500 ms; crash-free above 99.5% in the closed test; API 36 build with Restrict Minor Access on; a reviewer path with a live mentor; mentor coverage staffed for review and launch week; runbooks written.

Stop or roll back if: a seeded crisis message is missed; p95 stays above one second for ten minutes; crash-free falls below 99%; a store rejection is unresolved; fewer mentors online than the coverage plan needs; the restore drill fails.

## 9. Open decisions that gate tasks

| ID | Decision | Recommended | Gates |
|---|---|---|---|
| D1 | Chat backups versus Clean Wipe | B: two dumps, bodies 48 hours | T1.5, T5.6, T10.5 |
| D2 | Staff visibility, A to D | B: flagged window with a reason | T9.2, T10.5 |
| D3 | Two-person approval scope | bans, rule changes, any conversation view | T9.1 |
| D4 | How far to upgrade Expo | 54 first, then 57 | T6.2 |
| D5 | Store account type | organisation | H2 |
| D6 | Error tracker | GlitchTip, after the licence check | T1.7 |
| D7 | Cutover style | hard cutover at a release | T5.10 |
| D8 | Contributions | disabled at launch | none |
| D9 | Crisis second layer | grow the lexicon and build the eval set first | T8.3, T8.4 |
| D10 | Push payload | data-only after a device test | T7.3 |

## 10. Three ways to run this plan

All three use the roles in section 2. They differ in how much runs at once and how often production changes.

### Way 1 — Wave conductor (recommended)

One Opus conductor dispatches one wave at a time. Inside a wave up to six lanes run in parallel, each lane doing plan, build, two reviews per card. The integrator merges lanes one at a time at the wave end and runs the full gate. Production changes only at wave ends and only with the founder's approval.

- Strong: cheap to reason about; one merge point per wave; failures are caught at the gate; matches the lane procedure you already used for the board port.
- Weak: a slow lane holds up a wave; some idle agents.
- Best when: you want the safest single run of everything.
- Calendar estimate: about 9 to 11 weeks (my estimate).

### Way 2 — Standing lanes

Six long-lived Opus lane agents, each owning a domain for the whole program: Platform, Data and jobs, Auth and abuse, Chat (server and client), Mobile and Expo, Safety and admin. A written contract file (`docs/superpowers/program/CONTRACTS.md`) fixes the interfaces between lanes. The conductor mostly merges and arbitrates.

- Strong: fastest wall clock; deep domain memory in each lane.
- Weak: most merge conflicts (locales, tokens, `lib/api.ts`, `requirements.txt`, migrations chain); contract drift; harder to review.
- Best when: speed matters more than smooth merges and the contracts are well written first.
- Calendar estimate: about 7 to 9 weeks, with more rework risk.

### Way 3 — Release trains

Four shippable milestones, each run with Way 1 inside and strictly one after another, with a production release between them:

1. **M1 Foundation and store-safe base:** WS0, WS1, WS2, WS3, WS4, WS10 first cut, WS11 harness, Expo upgrade.
2. **M2 Own chat:** WS5, WS6 chat, WS7, cutover.
3. **M3 Control room and safety:** WS8, WS9, remaining WS10 and WS11.
4. **M4 Launch:** drills, closed test, staged rollout.

- Strong: value and learning arrive early; smallest blast radius; each release is real-world tested.
- Weak: longest calendar; some rework because early releases carry temporary shims (for example the old chat while the new one is built).
- Best when: you want to launch to a small group early and reduce risk the most.
- Calendar estimate: about 12 to 14 weeks.

**Suggested combination after refining:** Way 3's milestones with Way 1 inside each, adding Way 2's contract file for the two milestones where lanes touch the same files (M1 and M3). Choose after answering the refinement questions.

### Refinement questions before starting

1. Confirm D1 to D10 (recommended values in section 9).
2. Which way, or which combination?
3. Is there a hard launch date, or is quality the only constraint?
4. Who does the founder-only tasks in section 7, and when?
5. Are production deploys approved at each wave end, or only at milestones?

## 11. Appendix A — prompt templates

**Planner**

```text
You are the planner for workstream <WS>. Read docs/superpowers/plans/2026-09-20-mento-program-plan.md sections 3 and 4 and the task cards for this workstream, then read the current code in the lane worktree <path>. For each card write a bite-sized TDD sub-plan in the superpowers:writing-plans format (exact files, failing test first, exact commands with expected output, commit per step group) and save it to docs/superpowers/program/subplans/<task-id>.md. List any prerequisite that is missing or any card you think is wrong. Do not write feature code.
```

**Builder**

```text
You are the builder for task <ID> in lane worktree <path>. Follow docs/superpowers/program/subplans/<ID>.md step by step, test first. Keep every invariant in section 3 of the program plan. Run the verification commands for the layers you touched. Make conventional commits. Do not touch files outside the card's file list without saying why. When done, report: commits, test output, anything surprising. If a step cannot be done as written, stop and report instead of improvising.
```

**Spec reviewer**

```text
Review the diff for task <ID> against ONLY the acceptance criteria on its card in the program plan. List each criterion as met, not met or unclear, with file and line evidence. Do not comment on style.
```

**Quality reviewer**

```text
Review the diff for task <ID> for correctness bugs, missing tests, violated invariants (program plan section 3), unclear names, dead code and security problems. Rank findings by severity. Verify each finding against the code before reporting it.
```

**Integrator**

```text
Merge lane branches for wave <N> one at a time into master using the procedure in docs/superpowers/plans/2026-09-19-board-port-lanes.md. After each merge run bash scripts/lanes/gate.sh fast; after the last merge run bash scripts/lanes/gate.sh full. Resolve conflicts in locales, tokens, lib/api.ts, requirements.txt and the migration chain (one linear chain, re-chain revisions if needed). Report the gate output. Do not push or deploy.
```

## 12. Appendix B — coverage check against the board

| Board section | Tasks |
|---|---|
| Part 1-2 gaps (single box, backups, background jobs, pager, web deploy gate, stubs) | T1.1 to T1.10, T4.*, T8.9, T1.9, T8.1 to T8.4 |
| Part 2 store readiness (API 36, anonymous chat rules, child safety, health text, deletion page, UGC, data safety, permissions, tester rule, payments, Apple 1.2 and 2.1) | T6.2, T3.7, T3.9, T10.1 to T10.4, T0.1, T0.2, H2, H8, H15 |
| Part 3 alternatives (every ledger row) | T0.*, T1.*, T4.*, T5.*, T6.*, T7.*, T9.9, T13.1 |
| Part 3 auth plan (phases 0 to 4) | T0.6, T3.1 to T3.6, T3.10, T3.11 |
| Part 4 two environments | T1.1, T1.3, T1.4, T11.5 |
| Part 5 Balanced tier and target map | WS1, WS4, WS5, T1.7 |
| Part 6 roadmap, gates, stop conditions | sections 5 and 8 |
| Part 7 decisions, plan, future, scale | this plan; the "left for the future" list stays out of scope |
| Part 8 admin panel (12 areas, alert rules, visibility, build plan) | T3.12, T5.8, T8.5 to T8.7, T9.1 to T9.14 |
| Part 9 AI (triage, simulator, coach, refusals) | T8.1 to T8.10 now; simulator and coach are later work after triage is measured |

Left for the future (not in this program): own update server, helper server, point-in-time recovery, iOS, passkeys, trained Hinglish model, AI simulator and coaching card, Postgres 18, connection pooler, Centrifugo, read replica, second region, translation platform, analytics dashboard tool, paid-mentor module.
