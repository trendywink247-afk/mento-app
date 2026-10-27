# Mento Balanced Architecture — Design

Date: 2026-09-20 · Status: draft for founder review · Detail lives in the architecture board (Design canvas, pages 0-9) and the two HTML books on the founder's Desktop. This spec records the decisions and the target design; the program plan (`docs/superpowers/plans/2026-09-20-mento-program-plan.md`) says how to build it.

## 1. Decisions (founder, 2026-09-20)

| # | Decision |
|---|---|
| D1 | Build the **Balanced tier**: one 4 GB server in India, Caddy, Valkey, own chat, direct FCM, job queue, off-site backups, blue/green deploys, self-hosted Sentry-compatible error tracker. |
| D2 | **App updates stay on Expo's free EAS Update** for now. An own update server (xprem) is postponed until monthly users near ~800. |
| D3 | A **refined admin panel** with a safety desk that watches for crisis and for sensitive data. Visibility level and two-person approval are still open (section 7). |
| D4 | Goal: scalable, nothing to lose, passes every store and legal check. |

Superseded: the Lean and Resilient tiers, and the earlier plan to self-host OTA in the first release.

## 2. Goals and non-goals

Goals: remove Stream Chat, the Expo push relay, PostHog cloud and any hosted auth from the message and identity path; keep members anonymous; pass Google Play and Apple review; keep one write path where the crisis scan runs before a message is stored; give staff a safe control room.

Non-goals: an AI companion, live translation, mood prediction, client-side end-to-end encryption (the scan needs the text), streaks or a feed, audio, in-app payments at launch, self-hosted Sentry or PostHog in full, iOS in the first release.

## 3. Target architecture

Clients: Android app (Expo SDK 57), web app (same code), mentor console (in-app and web), admin dashboard (web only).

Edge: Caddy container. Automatic TLS. WebSocket support. Serves the static web build and proxies `api.` to the API. One Caddyfile for local and prod (host placeholders).

API (FastAPI, blue and green, sync SQLAlchemy kept):
- Own-chat WebSocket hub and history (`chat_messages`, `chat_read_markers`), presence in Valkey, fan-out over pub/sub, Postgres as source of truth.
- Message write path, in this order and no other: crisis scan (word list + phrase bank) → allowance → PII redaction → persist → fan-out. A guard model runs asynchronously as a job and can only add a flag.
- Auth: PyJWT, 15-minute access tokens, rotating refresh tokens with reuse detection, Play Integrity and a small proof-of-work at signup, optional recovery phrase, device-bound keys, separate signing secrets per role, one-time mentor console codes, member status (active, suspended, banned).
- Job worker (Procrastinate on Postgres): pushes, presence sweep, capacity reconcile, name rotation, retention purges, guard-model scans, backups status.
- Admin API: roles, two-factor, two-person approvals, safety desk, sensitive-data alerts, member and mentor management, rules editor, insights, system health, privacy requests.

Data: Postgres (tuned, explicit foreign keys, monthly partitions for messages, encrypted message bodies), Valkey (no persistence, `maxmemory`), off-site encrypted backups every 6 hours (restic to Backblaze) with message bodies excluded.

Outside: FCM (delivery only), Google Play and App Store, Backblaze, Expo EAS Update (free tier). Removed: Stream, Expo push relay, PostHog cloud, hosted auth.

Operations: GitHub Actions deploy with a deploy-only SSH key, migrations first, blue/green swap; UptimeRobot on `/health`, `/health/ready`, `/health/crisis`, web and disk; Beszel and CrowdSec on the box; alerts to the founder's phone; SOPS with age for secrets.

## 4. Data flow: one message

1. Client sends `{client_id, body}` over the WebSocket (auth was a first frame, never a URL parameter).
2. Server `chat.send`: lexicon scan and phrase-bank scan (150 ms budget, fail-open, never silent) → allowance (after the scan, skipped for crisis) → redaction → insert with per-conversation `seq` → commit → publish.
3. Other side receives by pub/sub or, after a drop, by `GET /chat/{id}/messages?after=seq`.
4. A flagged message stores only signal, category and score in `safety_flags` (never text) and shows the helpline card; the job queue schedules the guard-model scan and the push.

## 5. Staff visibility model (open decision, recommended B)

A signals only · **B a reviewer opens only the flagged window, with a reason, logged and time-limited (recommended)** · C B plus a live silent observer in an active crisis with the mentor told · D staff read every chat (not recommended). Whatever is chosen must be disclosed in `docs/PRIVACY.md` before launch. Illinois-style laws bar AI that detects mental states: describe the scan as a safety referral.

## 6. Error handling and failure modes

- Scan and allowance are fail-open with a budget, and a failure raises an alert (`/health/crisis` pages the founder), never a silent pass.
- Redis loss disables rate limits and dedupe but not correctness; onboarding rate limit fails closed.
- Deploy: migrations run as a separate step with a 3 s `lock_timeout`; a failed migration leaves the old containers serving.
- Backups exclude message bodies so Clean Wipe stays true; a weekly restore drill runs into the local stack and asserts row counts.

## 7. Open decisions

Chat backup option (A, B or C; recommended B), staff visibility (A to D; recommended B), two-person approval, how far to upgrade Expo (54 or 57), store account type (organisation recommended), GlitchTip versus Bugsink (check licences), cutover style (hard, recommended), contributions (disabled at launch), push payload (data-only, test first).

## 8. Testing

Everything on the tested-before-merge list in `CLAUDE.md` keeps its tests. New coverage: scan-before-persist on the only write path, exactly-once send, reconnect replay, Clean Wipe deletes bodies, refresh-token reuse detection, member ban blocks match and send, admin reads require a reason, backup exclusion, restore drill, Maestro native flows (onboarding to first message, two-party chat, crisis card), k6 load on the real server, Schemathesis on the OpenAPI, and axe checks on web specs.

## 9. Risks that shape the design

Apple guideline 1.2 (anonymous chat), Google's API 36 and anonymous-chat rules, backups that could undo Clean Wipe, a single server, and a Hinglish crisis eval set that does not yet exist. Each has a task and a gate in the program plan.

## 10. Unverified

WebSocket capacity (extrapolated from a laptop), Hostinger renewal price, Google's wording for anonymous-chat apps, Apple's OTA clause, error-tracker licences, US state AI-therapy law text, India's data-protection dates. These are listed on the board page 7 and must be confirmed before submission.
