# PROGRESS.md — Mento

> Restart-from-anywhere log. Newest entry on top. Each entry: Done / In-progress / Next / Open decisions / How to resume.

---

## 2026-06-08 (session 3) — slice runs clean end-to-end ✅

**Goal:** get the onboarding → match → chat slice actually running and verified. Done.

**Environment fixed**
- Python wasn't actually installed (earlier attempt hadn't taken). Installed **Python 3.12.10** via winget (per-user: `%LOCALAPPDATA%\Programs\Python\Python312`). Note: a freshly-opened shell will have it on PATH; the agent invoked it by full path.
- Backend deps installed into `services/api/.venv`; mobile deps via `npm install` + `npx expo install`.

**Backend — verified (SQLite, no Postgres/Redis needed for this slice)**
- API smoke (PowerShell) all passed: health; onboarding→persona+token; **age-gate blocks a minor (403)**; match→conversation + listener (Stream dev-stub channel); crisis scan benign=clean / "I want to die"→**suicidal + 2 helplines + support copy**; conversation end.

**Mobile — `tsc --noEmit` clean (exit 0).**

**UI smoke via Playwright (Expo web) — full path passed:** landing → DOB (web input) → skip email → growth companion (Surprise me) → connecting → **chat with persona "Misty Valley"**, then typed "honestly I want to die" → **crisis card rendered with Tele-MANAS · 14416 and KIRAN · 1800-599-0019** (tappable, 24×7) + support message. Screenshot saved (gitignored).

**Bugs found & fixed during verification**
1. **CORS:** `allow_credentials=True` + `allow_origins=["*"]` is rejected by browsers → set `allow_credentials=False` (Bearer-token auth, no cookies). `main.py`.
2. **Web session storage:** `expo-secure-store` is unsupported on web and threw in `saveSession` → added a platform-aware store (localStorage on web, SecureStore on native). `lib/session.ts`.
3. **Web date picker:** `@react-native-community/datetimepicker` doesn't render on web → added a `YYYY-MM-DD` text-input fallback on web (native keeps the spinner). `onboarding/age.tsx`.
4. **Missing web deps:** added `react-native-web`, `react-dom`, `@expo/metro-runtime`, `expo-asset`. (A stale Metro cache also required `expo start -c` once.)

**Not done (intentionally, per instruction):** no Stream real-time chat, no new features. Chat is still the local shell with the crisis scan wired.

**⚠️ Open items to carry forward (logged, not yet actioned)**
- **SQLite ≠ production stack.** The slice was verified on **SQLite**, but the real stack is **DigitalOcean Managed Postgres + Redis**. These differ on things that matter here: the "next-available" matcher relies on row-locking (`with_for_update(skip_locked=True)`), which is a **no-op on SQLite** — concurrency/double-assignment is therefore *not* yet proven. Also: **no Alembic migrations written yet** (dev uses `create_all`). **Must run against real Postgres (and exercise concurrent matching) before trusting under load.** Fine to defer; do not forget.
- **Web shims are the expected web/native split (working as designed, not bugs).** The four web-specific accommodations — localStorage session fallback, `YYYY-MM-DD` text-input date picker, and the web deps — confirm **web is our test surface**. The **native** flows (SecureStore, the DateTimePicker spinner, haptics, biometric lock) are exercised only on web so far and **still need device verification later (Maestro on iOS/Android).**
- **Stream real-time unit is gated on credentials.** Without `STREAM_API_KEY`/`STREAM_API_SECRET` in `services/api/.env`, Stream stays in stub mode and real-time cannot actually be verified (would be unrun code). Founder to add creds before that unit starts.

**Next**
1. Real-time chat via `stream-chat-expo` (stored `stream_token` + `stream_channel_id`).
2. Wire conversation-options flows to the backend.
3. Decide Postgres-for-dev vs keep SQLite-dev / Postgres-prod; add Alembic migrations before staging.

**How to resume / re-run the slice**
- Backend: `cd services/api`; set `ENV=dev`, `DATABASE_URL=sqlite:///C:/Users/khana/mento/services/api/mento_dev.db`, `JWT_SECRET=dev-secret`; `.\.venv\Scripts\python.exe -m scripts.seed_listeners`; `.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000 --reload`.
- Mobile: `cd apps/mobile`; `npx expo start --web --port 8081` (add `-c` if a fix doesn't appear).

---

## 2026-06-08 (session 2) — PRD patched + first build slice scaffolded

**Done**
- **Patched stale PRD sections** §4 / §6.1 / §12 / §15 / §18 to match `DECISIONS.md` (each marked with an update note; DECISIONS still governs).
- **Recorded the three founder rulings** in `DECISIONS.md` §H and marked them resolved in `ALIGNMENT.md` §6:
  1. Payments — drop ₹399/599/999 tiers; Razorpay = processor only; v1 = transparent coffee/tip (₹49–499 + open ceiling); Module B fees later.
  2. Storage — keep Stream Chat; "Panda Wipe" reworded to honest delete (device **and** servers) + real server-side delete; no on-device-only claims.
  3. Auth — no phone in user flow; optional email for recovery; MSG91 reserved for mentor verification (Module B).
- **Backend foundation** (`services/api`, FastAPI): config, anonymous JWT, SQLAlchemy 2.0 models (user/listener/conversation/request/safety/moderation/contribution/journal), persona generator, server-side age-gate onboarding, General matching (row-locked next-available) + Stream channel creation, **crisis-scan stub wired in** (signal-only flag + helplines + support-and-refer), conversation end + Panda Wipe (real server delete), listener seed script, dev-safe Stream stubs.
- **Mobile foundation** (`apps/mobile`, Expo SDK 52 + Router, TS): design tokens, typed API client, secure session store, components, and the **full onboarding flow** (landing → DOB/age → optional email → growth companion → connecting→match) + a **chat shell with the crisis scan + helpline card** wired to the backend.
- Added `.gitattributes` (LF normalization).

**In-progress / not yet verified**
- ⚠️ **Nothing has been run.** Python is absent on this machine (backend not executed/migrated) and the mobile app has not been `npm install`ed / typechecked / launched. Code is written to be correct; **review + run before trusting.**

**Next**
1. **Run the slice locally:** backend (`pip install`, seed listeners, `uvicorn`) + mobile (`npm install`, `expo start`); fix anything that surfaces. Add Stream + Razorpay creds.
2. **Real-time chat:** swap the chat shell's local state for the Stream Chat channel (`stream-chat-expo`) using the stored `stream_token` + `stream_channel_id`.
3. Wire the conversation-options flows (lock/status/pause/end/wipe/report) to the backend.
4. Then: journals + AI assistant, contribution surface, mentor discovery list.

**Open decisions** — unchanged (see `docs/ALIGNMENT.md` §6): under-18 hard block, final issue-category names, crisis-helpline numbers to verify at build, listener training curriculum.

**How to resume**
- `cd C:\Users\khana\mento`; read this entry → `CLAUDE.md` → `docs/DECISIONS.md`.
- To run: follow `services/api/README.md` then `apps/mobile/README.md`.
- Latest commit at time of writing: see `git log` (HEAD = mobile foundation).

---

## 2026-06-08 — Docs scaffolded + Step-1 alignment complete

**Done**
- Located source materials (were on `Desktop\Mento`, not in the repo) and **consolidated into the git repo** `C:\Users\khana\mento` (Desktop originals untouched). Repo is the project home.
- Read **`docs/PRD.md`** (v2.0) in full.
- Read **`docs/DECISIONS.md`** — founder added it mid-session (was empty at start); now the **authoritative** reconciliation (Option A). Treated as source-of-truth.
- Cataloged **all 64 mockups** → `docs/MOCKUP_INVENTORY.md` (faithful per-screen inventory + conflict flags).
- Produced the **alignment table** → `docs/ALIGNMENT.md` (PRD × mockups × build-now, every gap/contradiction flagged).
- Scaffolded the four docs: **`README.md`, `CLAUDE.md`, `AGENTS.md`, `PROGRESS.md`**.
- Wrote `.gitignore` for the intended Expo + FastAPI monorepo.

**In-progress**
- None — awaiting founder review of the docs + alignment before any build (checkpoint per the brief).

**Next (once approved)**
1. Resolve the 3 highest-priority open decisions below (they change architecture/legal).
2. Scaffold `services/api` (FastAPI + Postgres + Alembic + Redis) and `apps/mobile` (Expo SDK 52, TS, theme tokens).
3. Build vertical slice #1: **onboarding → anonymous match → live 1:1 chat** (the 30-second promise), with the crisis-scan stub wired from day one.

**Open decisions (need founder/CA input)** — full list in `docs/ALIGNMENT.md` §6
- ⚠️ **Razorpay model:** confirm transparent **contribution (₹49+) + Module B session fees**, *not* ₹399/599/999 membership tiers (PRD forbids membership framing).
- ⚠️ **Message storage vs "Panda Wipe":** mockups promise *"we don't store messages on our servers; on-device only"* — **Stream Chat stores server-side.** Change the copy or change the architecture. Trust + legal.
- **Under-18:** block entirely at MVP? (PRD recommends yes.)
- Realtime: Stream Chat vs self-hosted WebSocket.
- Final issue-category names (lean life/emotional, not UPSC-only).
- Crisis helplines: verify current India numbers (Tele-MANAS / KIRAN) at build.
- Stale PRD sections to patch (DECISIONS F): §4, §18, §6.1, §12, §15 — say the word and I'll update PRD.

**How to resume**
- Open this file, then `CLAUDE.md` (project brain) and `docs/DECISIONS.md` (rules).
- Repo: `C:\Users\khana\mento` (branch `master`). Nothing to run yet — app/backend not scaffolded.
- To continue: get founder sign-off on the alignment + the 3 ⚠️ decisions, then start the `services/api` + `apps/mobile` scaffold and the onboarding→chat slice.
