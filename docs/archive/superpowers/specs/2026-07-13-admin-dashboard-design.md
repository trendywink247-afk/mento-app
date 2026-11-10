# Mento Admin dashboard — design spec

**Date:** 2026-07-13 · **Status:** approved in brainstorm (founder), pending spec review
**Decided during brainstorm:** users = founder + 1–2 trusted helpers · crisis review = live read-only conversation view · platform = `/admin` web-only routes in the Expo app · layout = cockpit home + top tabs · all seven sections in scope, nothing cut.

## Purpose

One place for every operational duty Mento has today, replacing CLI scripts and the
static-token API stand-ins: crisis-flag review, moderation, listener management,
platform pulse, health, contributions audit (stub), and admin access management —
without ever compromising member anonymity.

## Architecture

- **Frontend:** web-only expo-router routes under `app/admin/` delegating to
  `components/admin/*.web.tsx` (native = existing `WebOnlyNotice`), exactly the
  listener-console pattern. Desktop-first: top tab bar with unreviewed-count badges,
  max-width ~1100px container, existing theme tokens (indigo brand, no per-user accent).
- **Client:** `lib/adminApi.ts` typed client + `lib/adminSession.ts`
  (`mento.admin.session_token` in localStorage; distinct from user/listener keys).
- **Backend:** new `routers/admin_console.py` (prefix `/admin`), guarded by a
  `current_admin` dependency. All new endpoints below live there.

## Auth & accounts

- Table `admin_accounts`: `id`, `name`, `role` (`owner` | `helper`), `status`
  (`active` | `revoked`), `created_by`, timestamps.
- JWT with `role: "admin"` claim (same HS256 secret & pattern as listener tokens,
  TTL 30d). Delivered as `#token=` fragment links. `current_admin` re-checks
  `status == active` per request → **revocation is instant**. `current_user_id` /
  `current_listener_id` / `current_admin` mutually reject (three-way role isolation).
- **Bootstrap:** `scripts/issue_admin_token.py --owner --name "<name>"` creates the
  first owner row and prints the link. Subsequent admins are added from the UI
  (owner-only), which returns a shareable `#token=` link.
- The legacy static `x-admin-token` endpoints remain until this ships, then are removed.

## Audit trail

- Table `admin_audit_log`: `id`, `admin_id`, `action` (string, e.g. `flag.reviewed`,
  `conversation.viewed`, `listener.suspended`, `request.accepted`, `admin.revoked`),
  `subject_type`, `subject_id`, `meta` (JSON, small), `created_at`.
- Written **server-side** in every mutating admin endpoint and in the conversation
  message fetch (reads are logged). Never contains message text.
- Surfaced in the Admins tab: newest-first table, filter by admin and action, paginated.

## Sections & endpoints

### 1. Overview (landing tab)
- `GET /admin/overview` → `{ members_today, matches_today, active_conversations,
  listeners_online, flags_unreviewed, reports_unreviewed, match_failures_today,
  attention: [{kind, text, href}] }` — computed from Postgres; crisis sessions are
  **excluded from engagement counts** (T&S #5/#10).
- UI: stat tiles (flags/reports tiles turn red when > 0), "Needs attention" list
  (deep-links into tabs), compact health strip. Auto-refresh 60s + manual button.

### 2. Safety review (crisis flags)
- `GET /admin/safety/flags?reviewed=false&limit&offset` → flag rows: signal, member
  persona, listener persona (via conversation), conversation_id, created_at.
- `GET /admin/conversations/{id}/messages` → **fetched live from Stream server-side**,
  read-only, personas only; never persisted; writes `conversation.viewed` audit row.
- `POST /admin/safety/flags/{id}/review {action: helpline_shown | escalated |
  no_action, note?}` → sets `reviewed`, `reviewed_by=<admin name>`, `action`.
- UI: queue grouped by signal chips; row → drawer with flag detail + "Open
  conversation" panel + review buttons.

### 3. Moderation (reports & blocks)
- `GET /admin/moderation/queue` (JWT twin of the existing queue) +
  `POST /admin/moderation/{event_id}/resolve {note?}`.
- `POST /admin/listeners/{id}/suspend` / `POST /admin/listeners/{id}/reinstate`
  (suspension flips `vetting_status` — instantly revokes the listener console, already
  proven). One-click suspend directly from a report row.

### 4. Listener management
- `GET /admin/listeners` → full roster incl. vetting_status, status, load, categories,
  rank, created_at.
- `POST /admin/listeners {categories, max_concurrent, gender?}` → auto-generates
  persona (existing generator), status offline, vetting approved.
- `PATCH /admin/listeners/{id} {categories?, max_concurrent?, rank?}`.
- `POST /admin/listeners/{id}/console-link` → issues + returns the `#token=` URL
  (audit-logged; re-issue = old token still valid until expiry — revocation is via
  suspend, which kills all of that listener's tokens per-request).
- Requests oversight: `GET /admin/requests/pending`, accept/decline via the existing
  shared row-locked `services.matching` path.

### 5. Contributions (stub)
- `GET /admin/contributions` → empty list until Razorpay wiring; UI tab ships with
  the table (amount, status, Razorpay ids, created_at) + honest empty state.

### 6. System health
- `GET /admin/health/deep` → `{ db_ok, redis_ok, stream_configured,
  last_webhook_at, rate_limiter_ok }`. Each webhook handler stamps
  `mento:last_webhook_at` in Redis — the fail-open crisis design finally gets a
  **silent-death detector** surfaced in the UI (red when stale > 15 min while
  messages are flowing).

### 7. Admins & audit
- Owner-only: `GET /admin/admins`, `POST /admin/admins {name}` → returns link,
  `POST /admin/admins/{id}/revoke`.
- `GET /admin/audit?admin_id&action&limit&offset` → the audit table.

## Anonymity constraints (non-negotiable)

- No admin payload ever includes email, DOB, or age — personas only.
- Message bodies are never stored server-side; the live view is fetch-and-forget.
- Every conversation view is audit-logged.
- **Privacy policy must disclose** that trained safety staff can access conversations
  for crisis review (founder to-do before launch).

## Testing bar

- **pytest:** three-way role rejection; owner-only guards (helper hitting admin-mgmt
  → 403); instant revocation; audit row written per mutation AND per conversation
  view; safety review flow end-to-end; listener create/patch/suspend (suspension
  revokes console access); overview counts exclude crisis sessions; health endpoint.
- **Playwright (desktop 1280×900, 0 console errors):** owner link authenticates →
  cockpit shows live counts → safety queue → open conversation (live messages
  render) → mark reviewed (badge decrements) → suspend + reinstate a listener →
  issue console link (works in a second context) → add helper → helper link works →
  revoke → helper's next action fails with the designed error state.

## Out of scope (v1)

Charts/PostHog wiring, message search, member management, email/push notifications
to admins, native admin app, contribution refunds (until Razorpay), role granularity
beyond owner/helper.
