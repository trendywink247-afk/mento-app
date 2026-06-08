# CLAUDE.md — Mento project memory

> Auto-loaded every session. Keep tight and current. If this conflicts with the code, fix one of them — don't let them drift.
> **Source-of-truth order:** `docs/DECISIONS.md` → `docs/PRD.md` → mockups (`docs/Mockups/`, cataloged in `docs/MOCKUP_INVENTORY.md`). DECISIONS wins on any conflict.

---

## What Mento is

An **anonymous, low-friction emotional-support app**. A person in a hard moment opens it and is talking to a real human in under 30 seconds — no login, no name, no judgment. UPSC aspirants are the **first community**, not the product. Mentor-led UPSC *sessions* and the UPSC *self-assessment* suite are **later modules**, not v1.

Hero experience: **anonymous 1:1 chat** — "I just need to talk."

Quality bar: international B2C. No user manual. Delightful, seamless, experience-first. Make the opinionated call a top-tier consumer app would make; note it in `PROGRESS.md` under "Open decisions" when it's load-bearing.

---

## Stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| Mobile | **Expo SDK 52** (React Native, TS) | iOS + Android primary; **web = best-effort**, not co-equal (biometric, haptics, long-press gestures degrade on web). |
| Backend | **FastAPI** (Python 3.12) | async; Pydantic v2. |
| DB | **DigitalOcean Managed Postgres** | SQLAlchemy 2.0 + Alembic migrations. |
| Cache/realtime-support | **Redis** | presence, matching queue, rate limits, pub/sub. |
| Messaging | **Stream Chat** (getstream.io) | ships presence/typing/read-state/push fast. ⚠️ **Open conflict** — see Trust & Safety #8 (the "we don't store messages on our servers" / Panda Wipe promise). |
| Payments | **Razorpay** (UPI/Card/NetBanking) | processor for **contributions** + later Module B session fees. ⚠️ **Not** the ₹399/599/999 membership tiers — see SCOPE. |
| OTP | **MSG91** | **NOT in the v1 user path** (no phone for users). Reserve for mentor phone-verification in the deferred Module B. |
| Analytics | **PostHog** | ⚠️ never send message content or PII; exclude crisis sessions from retention metrics. |

---

## Repo layout (target)

```
mento/
  apps/mobile/        Expo SDK 52 RN app (iOS/Android/web)
  services/api/       FastAPI backend
  docs/
    PRD.md            Product requirements (v2.0)
    DECISIONS.md      Authoritative reconciliation — WINS on conflict
    ALIGNMENT.md      PRD × mockups × build-now table
    MOCKUP_INVENTORY.md  Faithful catalog of all 64 screens
    Mockups/          64 source screens (.jpeg)
  README.md           Human onboarding / how to run
  CLAUDE.md           This file
  AGENTS.md           Cross-tool brief → points here
  PROGRESS.md         Living checkpoint log (restart-from-anywhere)
```

---

## Coding conventions

- **TypeScript** everywhere in mobile; `strict: true`. No `any` without a `// reason:` comment.
- **Python**: type hints required; `ruff` + `black`; functions do one thing.
- Components: function components + hooks. One component per file. Co-locate styles.
- **Design tokens, never raw hex** in components — consume the tokens below via a theme.
- API contracts: Pydantic models in/out; generate a typed client for mobile (openapi-typescript) rather than hand-writing fetch types.
- Naming: `snake_case` (Python/DB), `camelCase` (TS), `PascalCase` (components/types).
- Migrations are forward-only and reviewed; never edit a shipped migration.
- Tests before merge for: matching, routing, crisis-scan, payments, age-gate. (TDD where practical.)
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).

---

## SCOPE

### v1 — build now (Module A: anonymous emotional-support chat, polished light-mode)
1. **Onboarding** — landing → "Start a Conversation" → affirmation/safe-space → **DOB (correct D/M/Y picker)** + age-gate → **optional email** (skip-able) → growth-companion (animal+colour) → connecting → lands in chat.
2. **Anonymous identity** — auto-assigned `[Evocative] [Nature]` persona for **both** sides (e.g. "Purple Valley", "Silent Mountain"). No real names/photos/"Verified" badges in v1 chat.
3. **Real-time 1:1 chat** — text + emoji, instant send, typing indicator, read state. Clean/spare (Claude/ChatGPT-like), not a busy messenger.
4. **New-chat routing** — **General** (next-available match) + **Personal** (pick a mentor → intro message → request → inbox). Topic chips lean **life/emotional** (family, relationships, self-esteem, loneliness, focus), not UPSC-only.
5. **Mentor/listener discovery** — list + filters (issue · gender · availability), profiles (no star ratings). *Anonymous personas in v1; real mentor profiles ship with Module B.*
6. **Conversation controls** — Conversation Options sheet: Lock (PIN, simplified — see #DoD), Status mask ("Panda Mask"), Pause notifications ("Panda Pause"), End + delete ("Panda Wipe"), Report/Block, Support-the-team (contribution).
7. **Save-to-journal from chat** — long-press a mentor message → save to "Mentor Notes". The core talk→action loop. **Build the action** (mockups drew the destination, not the gesture).
8. **End-of-conversation reflection** — energy slider (drained ↔ energized), private. **No points/XP.** Decouple entirely from money.
9. **Journals** — AI Journal Assistant (conversational logging) feeding: **Finance** (expense tracker), **Mood/Daily**, **Mentor Notes**. Gratitude/Panda Wisdom optional. Carry over / don't rebuild.
10. **Crisis & safety flow** — real implementation (see Trust & Safety). Non-negotiable in v1.
11. **Contribution ("coffee")** — transparent, opt-in, from the menu; never inside a live conversation; supports the *team*, not the listener.
12. **Design system** — light-mode indigo/lavender v1 (mockups win over PRD's grey/white test build).

### v2 — deferred (spec separately, don't build by default)
- **Module B**: mentor real profiles, paid 1:1 sessions (price + ~10% platform fee), mentor portal, MSG91 mentor verification.
- **UPSC self-assessment suite**: The Mirror / Knowledge Assessment / Preparation Challenges / month-over-month growth dashboard. **Defer.**
- **UPSC Journey** study tracker. Defer (UPSC-coaching, not emotional-support core).
- **Community** tab (referenced in mockups, no screen exists).
- Account creation (email+password) as a hard gate — keep anonymous-first; "save your journey" is optional.
- Listener reputation rank, paid-session conversion.
- Moderation console (Module C, build third).

### Out (for now)
- Bank-notification expense capture (PRD §13, post-MVP, permission-gated).
- Group sessions.
- The ₹399/599/999 **membership tiers** and any hidden/dark-pattern payment (PRD §8 forbids).

---

## Definition of Done (per v1 feature)

- **Onboarding**: cold-launch → live chat in ≤ 30s on mid Android; DOB picker is real D/M/Y; age computed server-side; under-min-age blocked; email truly skippable; companion choice persisted & themable later.
- **Chat**: send→delivered p95 < 500ms; typing + read state correct; survives a network drop with auto-reconnect < 3s and no lost/dup messages; long-press → Save to Mentor Notes works; persona names render on both sides.
- **Routing**: General matches an available listener; Personal lands in that mentor's inbox with accept/decline; no double-assignment under concurrency (tested).
- **Conversation controls**: each option in the sheet has a working flow; Report/Block removes the chat and files a moderation event; End vs Panda-Wipe behave exactly as the copy promises (and the copy matches what the backend actually does — see #8).
- **Reflection**: private, stored without identity linkage to content; no points; never routes into a payment as a "reward".
- **Crisis flow**: trigger scan on inbound messages → surface verified India helplines → switch tone to support-and-refer → flag for human review → session excluded from retention metrics.
- **Contribution**: reachable from menu day one; never auto-opens in a conversation; copy states it supports the *team*; receipt + audit row written.
- **Every screen**: matches a token-based theme; 60fps transitions; empty/loading/error states designed; accessible tap targets; works one-handed.

---

## Trust & Safety — NON-NEGOTIABLE

1. **Crisis architecture (PRD §10).** Lightweight self-harm/abuse signal scan on inbound messages → immediate India resources (**Tele-MANAS / KIRAN — verify current numbers at build time**) → tone switches to support-and-refer (never retain) → human-review flag. A user in genuine crisis is helped *out*, not retained.
2. **Listeners are not therapists.** Stated in onboarding + UI. **No diagnosis, no clinical claims** in any copy.
3. **Age gate.** DOB enforces a minimum age. **Recommend excluding under-18 at MVP** (minors + mental health + payments = high-risk). Confirm with CA.
4. **Honest money.** Contribution is opt-in, never gated, never required, **never inside a live conversation**, never hidden, never framed as a membership. Copy says it supports the *team/platform*, not the individual listener. Session fees (Module B) are separate and explicit.
5. **No dependency engineering.** Measure "did the user leave with something usable," not hours of attachment. Retention metrics **exclude crisis sessions**.
6. **Minimize PII; policy must match reality (PRD §14).** Don't collect what we promised not to. Privacy policy ↔ actual data flows must match exactly.
7. **Anonymity integrity.** v1 chat uses personas only — no real names/photos. Don't leak identity through avatars, metadata, or analytics.
8. **⚠️ The storage promise.** Mockups (#26) tell users *"Mento doesn't store your messages on our servers; they live only on your device"* and offer "Panda Wipe" (delete both sides). **Stream Chat stores messages server-side.** This must be resolved before launch — either (a) change the copy to match reality, or (b) choose a local-first/E2E architecture. **Do not ship the promise with a backend that contradicts it.** (Open decision — see PROGRESS.)
9. **Moderation (PRD §11).** Layered: structural friction → listener redirect → warning → temp suspension. Report/Block reasons captured. Abusive/extractive users are not worth retaining.
10. **Analytics discipline.** PostHog never receives message content or PII. Crisis sessions never feed engagement/retention dashboards.

---

## Performance targets (B2C)

| Metric | Target |
|---|---|
| Cold start → interactive (mid Android) | < 2.0s |
| Onboarding → live chat | < 30s (PRD promise) |
| Message send → delivered (p95) | < 500ms |
| Reconnect after network drop | < 3s, zero lost/dup messages |
| API latency (p95) | < 300ms |
| Screen transitions | 60fps, no dropped-frame jank |
| Crash-free sessions | > 99.5% |
| App binary size | < 40MB |
| Journals | readable offline |

---

## Light-mode colour tokens (v1, indigo/lavender)

> Starter set — **calibrate exact hex against the mockups** during the design-system build (`docs/Mockups/`). Components consume tokens, never raw hex.

```
--bg            #F6F4FB   /* soft lavender-white app background */
--surface       #FFFFFF   /* cards, sheets, chat surface */
--surface-alt   #EFEBFA   /* subtle raised / selected */
--ink           #1E1B39   /* primary text (deep indigo-navy) */
--ink-muted     #6B6880   /* secondary text */
--brand         #5B4FE3   /* primary indigo/violet — CTAs, active */
--brand-press   #4A3FC9   /* pressed state */
--brand-tint    #ECE9FD   /* brand wash / chips */
--accent-warm   #F2A65A   /* contribution affordance only (subtle) */
--success       #3FB97A   /* income, positive */
--warning       #E6A23C   /* caution */
--danger        #E5534B   /* end/report/destructive */
--border        #E6E2F2
--shadow        rgba(30,27,57,0.08)
```

Mood/finance charts may use a multi-hue categorical scale (purple/blue/green/amber) — define as a separate `chart.*` token group, not reused for UI chrome.

---

## How to resume
Read `PROGRESS.md` first — it has the latest Done / In-progress / Next / Open decisions / How to resume.
