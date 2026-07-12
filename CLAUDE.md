# CLAUDE.md — Mento project memory

> Auto-loaded every session. Keep tight and current. If this conflicts with the code, fix one of them — don't let them drift.
> **Source-of-truth order:** `docs/DECISIONS.md` → `docs/PRD.md` → mockups (`docs/Mockups/`, cataloged in `docs/MOCKUP_INVENTORY.md`). DECISIONS wins on any conflict.

---

## What Mento is

An **anonymous, low-friction emotional-support app**. A person in a hard moment opens it and is talking to a real human in under 30 seconds — no login, no name, no judgment. UPSC aspirants are the **first community**, not the product. Mentor-led UPSC *sessions* and the UPSC *self-assessment* suite are **later modules**, not v1.

Hero experience: **anonymous 1:1 chat** — "I just need to talk."

Quality bar: international B2C, and since the 2026-07-11 rulings (DECISIONS §I) explicitly **beyond the mockups**: cinematic motion, depth, light and a living companion — in the Calm/Headspace register, never gamified, **no 3D engine, no audio**. **The user's chosen animal is the star** — after the pick, their companion (not a fixed panda) carries identity everywhere. Make the opinionated call a top-tier consumer app would make; note it in `PROGRESS.md` under "Open decisions" when it's load-bearing.

---

## Stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| Mobile | **Expo SDK 52** (React Native, TS) + expo-router 4 | iOS + Android primary; **web = dev/test surface** (Playwright), best-effort UX. |
| Motion | **Reanimated 3.16** + **@shopify/react-native-skia 1.5** + expo-haptics | Skia 1.5 is the SDK 52 pin (v2 needs SDK 53+). Ambient SkSL aurora + motion tokens (`theme/motion.ts`). Web lazy-loads CanvasKit, falls back to a static gradient. |
| Backend | **FastAPI** (Python 3.12) | async; Pydantic v2. |
| DB | **Postgres 16** (compose locally → DigitalOcean managed) | SQLAlchemy 2.0 + Alembic migrations; matcher relies on row locks (`FOR UPDATE SKIP LOCKED`). |
| Cache/realtime-support | **Redis** | **rate limiting is live** (`app/ratelimit.py`: onboarding per-IP, match per-user, PIN attempt caps — fail-open, never silent). Presence/matching state lives in Postgres row locks, not Redis. |
| Messaging | **Stream Chat** (getstream.io) | presence/typing/read-state; **crisis scan enforced via its webhooks** (see T&S #1). Storage promise resolved — see T&S #8. |
| Payments | **Razorpay** | processor for **contributions** + later Module B session fees. **Not** membership tiers (DECISIONS §H.1). Awaiting creds — coffee screen ships transparently disabled. |
| OTP | **MSG91** | **NOT in the v1 user path**. Reserved for mentor verification (deferred Module B). |
| Analytics | **PostHog** | never message content or PII; crisis sessions excluded from retention metrics. |

---

## Repo layout (actual)

```
mento/
  apps/mobile/
    app/                    expo-router: index (landing) · onboarding/ (ONE journey route + legacy stubs)
                            · chat/[id] · (tabs)/ chats|journals|mentors|profile · reflection · coffee
    components/
      art/                  SVG system: Logo, Panda poses, AnimatedPanda rig, CompanionArt ×6, Scenes, PersonaAvatar
      motion/               AmbientBackground(.web), AuroraCanvas (SkSL), PandaStage, Entrance,
                            StepTransition, useBreathing, ambientLift, StaticAmbient
      onboarding/           OnboardingJourney (step machine) + steps/ + StepScaffold
      chat/                 ChatScreen(.web) platform split, ConversationOptions + options/
    theme/                  tokens.ts (colour/type/space/elevation) · motion.ts (duration/easing/spring/
                            stagger/breathe) · companion.ts (7 accent sets) · ThemeProvider (live accent)
    lib/                    api.ts (typed client) · session.ts · haptics.ts · useReducedMotion(.web).ts · onboardingDraft.ts
  services/api/
    app/                    routers/ (onboarding, match, conversation, stream_hooks, moderation,
                            journals, listeners, listener_console, admin_console, safety, health)
                            · services/ (matching, stream, safety, audit) · models/ (incl. admin)
                            · security.py · ratelimit.py · config.py
    scripts/                seed_listeners · configure_stream · sample_mockup_colors
    tests/                  pytest — 10 files / 35 tests incl. matcher concurrency, crisis webhook
                            proofs, and security hardening (age gate, wipe, PIN lockout, scan ownership)
    docker-compose.yml      Postgres 16 + Redis 7
  docs/                     PRD.md · DECISIONS.md (WINS) · ALIGNMENT.md · MOCKUP_INVENTORY.md · Mockups/
  .github/workflows/        api-ci.yml (compose → alembic upgrade+check → pytest)
  README.md  CLAUDE.md  AGENTS.md  PROGRESS.md
```

---

## Coding conventions

- **TypeScript** everywhere in mobile; `strict: true`. No `any` without a `// reason:` comment.
- **Python**: type hints required; `ruff` + `black`; functions do one thing.
- Components: function components + hooks. One component per file. Co-locate styles.
- **Design tokens, never raw hex** in components — consume via `useTheme()`.
- **Motion rules (non-negotiable):**
  - Timings/easings from `theme/motion.ts` — never raw durations/beziers in components.
  - Animate **transform and opacity only** — never layout props (60fps mid-Android is a hard target).
  - **Manual shared values, never Reanimated `entering=`/`exiting=`** (flaky on react-native-web, our test surface).
  - Every animation consults `useReducedMotion` — reduced = ≤150ms opacity-only, loops off, shader frozen. The flow must be fully usable with all motion stripped.
  - Calm register: no overshoot springs, ≤3 simultaneous movers, breathing-tempo idles. No Skia blur/backdrop on Android.
- API contracts: Pydantic models in/out; typed client in `lib/api.ts` (extend it, don't hand-write fetch).
- Naming: `snake_case` (Python/DB), `camelCase` (TS), `PascalCase` (components/types).
- Migrations are forward-only and reviewed; never edit a shipped migration.
- Tests before merge for: matching, routing, crisis-scan, payments, age-gate, listener-console auth/scoping.
- Web/native splits use the `.web.tsx` file convention (see `components/AppProviders*`, `ChatScreen*`).
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`); each unit proven (pytest / tsc / Playwright at 390×844 with 0 console errors) before the next.

---

## SCOPE

### v1 — build now (Module A: anonymous emotional-support chat, polished light-mode)
1. **Onboarding** — cinematic single-route journey (landing → DOB age-gate → optional email → growth-companion → ready → connecting → chat) over a persistent aurora sky + living companion. D/M/Y picker, age computed server-side, email truly skippable.
2. **Anonymous identity** — auto-assigned `[Evocative] [Nature]` persona for **both** sides. No real names/photos/"Verified" badges in v1 chat.
3. **Real-time 1:1 chat** — text + emoji, instant send, typing indicator, read state. Clean/spare, not a busy messenger.
4. **New-chat routing** — **General** (next-available match) + **Personal** (pick a mentor → intro → request → listener inbox). Topic chips lean life/emotional.
5. **Mentor/listener discovery** — list + filters, profiles (no star ratings). Anonymous personas in v1.
6. **Conversation controls** — Lock (PIN), Panda Mask, Panda Pause, End + Panda Wipe (honest server delete), Report/Block, Support-the-team.
7. **Save-to-journal from chat** — long-press/tap a mentor message → Mentor Notes. The core talk→action loop.
8. **End-of-conversation reflection** — private energy slider. **No points/XP.** Decoupled from money.
9. **Journals** — hub + Mood/Finance/Gratitude/Mentor Notes; AI Journal Assistant pending the LLM decision.
10. **Crisis & safety flow** — real, server-side (see Trust & Safety). Non-negotiable.
11. **Contribution ("coffee")** — transparent, opt-in, from the menu; never inside a live conversation; supports the *team*.
12. **Design system** — light-mode indigo/lavender + the motion token system; **companion-is-the-star** theming (accent + animal follow the user's choice everywhere).
13. **Minimal listener console (DECISIONS §I.6)** — web-only, per-listener token-link auth: own conversations, real-time reply, accept/decline own Personal requests, online/away toggle. Nothing more.
14. **Admin dashboard** — web-only `/admin` (spec `docs/superpowers/specs/2026-07-13-admin-dashboard-design.md`), owner/helper token-link auth (per-request revocation), full audit trail. Seven tabs: Overview cockpit · Safety review (audited read-only live conversation view — bodies never stored) · Moderation (+ one-click suspend) · Listener management (replaces the CLI scripts) · Contributions stub · Health (incl. silent-webhook-death detector) · Admins + audit. Bootstrap: `python -m scripts.issue_admin_token --owner --name "<n>"`. **Privacy policy must disclose safety-staff conversation access before launch.**

### v2 — deferred (spec separately, don't build by default)
- **Module B**: mentor real profiles, paid 1:1 sessions (+~10% platform fee), full mentor portal, MSG91 verification.
- **UPSC self-assessment suite** (Mirror / Knowledge Assessment / Challenges / growth dashboard). **Defer.**
- **UPSC Journey** study tracker · **Community** tab · account creation as a gate · listener reputation rank · moderation console (Module C).
- **Mascot asset upgrade** executes only after the founder picks from `docs/MASCOT_ASSETS.md` (DECISIONS §I.4) — until then the SVG rig is the interim mascot.

### Out (for now)
- Bank-notification expense capture (PRD §13). Group sessions. The ₹399/599/999 **membership tiers** and any hidden/dark-pattern payment.

---

## Definition of Done (per v1 feature)

- **Onboarding**: cold-launch → live chat ≤ 30s on mid Android (currently ~5s on web); journey deep-links guard on the draft; under-min-age blocked server-side; email truly skippable; companion choice persisted & themes the app live.
- **Motion**: every animation uses motion tokens, transform/opacity only, respects reduced motion (Playwright `reducedMotion: 'reduce'` run stays static and completes); first frame is always the static gradient; 0 console errors.
- **Chat**: send→delivered p95 < 500ms; typing + read state correct; reconnect < 3s, no lost/dup messages; save-to-Mentor-Notes works; persona names render on both sides.
- **Routing**: General matches an available listener; Personal lands in that listener's inbox with accept/decline; no double-assignment under concurrency (tested).
- **Conversation controls**: each option has a working flow; Report/Block files a moderation event; End vs Panda-Wipe behave exactly as the copy promises.
- **Reflection**: private, stored without identity linkage; no points; never routes into a payment as a "reward".
- **Crisis flow**: inbound scan → verified India helplines → support-and-refer → human-review flag → excluded from retention metrics.
- **Contribution**: reachable from menu; never auto-opens in conversation; copy says *team*; receipt + audit row (lands with Razorpay wiring).
- **Listener console**: token link authenticates exactly one approved listener; suspension revokes instantly; listener sees only their own conversations/requests; accept keeps the row-locked no-double-assignment guarantee; reply delivers live to the member; crisis card renders listener-side.
- **Every screen**: token-based theme; 60fps transitions; empty/loading/error states; accessible tap targets; works one-handed.

---

## Trust & Safety — NON-NEGOTIABLE

1. **Crisis architecture (PRD §10).** Signal scan on inbound messages → India resources (**Tele-MANAS 14416 / KIRAN 1800-599-0019 — re-verify before launch**) → support-and-refer tone → human-review flag. A user in genuine crisis is helped *out*, not retained.
   - **Enforcement is server-side, on the message path.** The scan runs in the Stream **before-message-send webhook** (`services/api` `routers/stream_hooks.py`), called server-to-server for *every* message regardless of sender — the client cannot route around it. Flag = `SafetyFlag` (signal only, never the body); the message is augmented with a `crisis` payload the client renders. *(Proven: a message sent straight through the Stream API still flags + augments.)*
   - **Fail-mode (deliberate): fail-open, never silent.** If our API is unreachable the message is delivered unscanned (never hard-block a support conversation); the retried async `message.new` webhook re-scans anything missed. Both hooks dedupe by Stream message id (unique index — race-proof).
   - **Startup invariants (app/main.py):** outside dev the API refuses to boot with the default `JWT_SECRET` or without Stream creds — either state silently disables a security guarantee (forgeable tokens / unscanned messages).
2. **Listeners are not therapists.** Stated in onboarding + UI. No diagnosis, no clinical claims in any copy.
3. **Age gate.** DOB enforces minimum age (18) server-side. Under-18 exclusion at MVP — confirm with CA.
4. **Honest money.** Contribution is opt-in, never gated, never inside a live conversation, never framed as membership. Copy says it supports the *team/platform*.
5. **No dependency engineering.** Measure "did the user leave with something usable." Retention metrics exclude crisis sessions.
6. **Minimize PII; policy must match reality (PRD §14).**
7. **Anonymity integrity — both sides.** v1 chat uses personas only. The listener console shows member *personas* only; listeners never see age, email, or identity. Don't leak identity through avatars, metadata, or analytics.
8. **The storage promise (resolved — DECISIONS §H.2).** "Delete from your device **and** our servers" — Panda Wipe is implemented and proven to hard-delete channel + messages on Stream (`/conversations/{id}/wipe`). Never reintroduce an on-device-only claim.
9. **Moderation (PRD §11).** Layered: friction → redirect → warning → suspension. Report/Block reasons captured. The listener token is revoked instantly by `vetting_status=suspended`.
10. **Analytics discipline.** PostHog never receives message content or PII. Crisis sessions never feed engagement dashboards.
11. **Motion/haptics restraint.** No audio anywhere (public-place safety). Reduced-motion is honoured end-to-end. Error states go *still* — stillness signals the problem; nothing shakes or buzzes at a struggling person.

---

## Performance targets (B2C)

| Metric | Target |
|---|---|
| Cold start → interactive (mid Android) | < 2.0s (first frame = static gradient, Skia mounts after) |
| Onboarding → live chat | < 30s (measured ~5s on web) |
| Message send → delivered (p95) | < 500ms |
| Reconnect after network drop | < 3s, zero lost/dup messages |
| API latency (p95) | < 300ms |
| Screen transitions | 60fps — transform/opacity only, release-build gfxinfo gate pending (PROGRESS) |
| Crash-free sessions | > 99.5% |
| App binary size | < 40MB (Skia adds ~3–5MB — within budget) |
| Journals | readable offline |

---

## Design tokens

**The code is the source of truth**: colours/type/space/elevation in `apps/mobile/theme/tokens.ts` (pixel-calibrated against the mockups via `scripts/sample_mockup_colors.py` — warm-cream `bg #FDF8F5`, ink `#1D2142`, default accent `#5847D6`, `accentSoft #8177C9`, pastel `wash.*`), per-user companion accents in `theme/companion.ts` (7 sets, layered live by `ThemeProvider`), **motion tokens** in `theme/motion.ts` (durations 200–700ms, calm easings, spring, 80ms stagger unit, 5.2s breathe). Components consume tokens — never raw hex, never raw durations.

Mood/finance charts may use a multi-hue categorical scale — define as a separate `chart.*` token group when needed, not reused for UI chrome.

---

## How to resume
Read `PROGRESS.md` first — latest Done / In-progress / Next / Open decisions / How to resume. Run book in `README.md`.
