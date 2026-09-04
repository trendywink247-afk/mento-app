# CLAUDE.md — Mento project memory

> Auto-loaded every session. Keep tight and current. If this conflicts with the code, fix one of them — don't let them drift.
> **Source-of-truth order:** `docs/DECISIONS.md` → `docs/PRD.md` → mockups (`docs/Mockups/`, cataloged in `docs/MOCKUP_INVENTORY.md`). DECISIONS wins on any conflict.
> **Resume protocol:** read `PROGRESS.md` (newest-on-top) before touching code. End every session by updating `PROGRESS.md` (Done / In-progress / Next / Open decisions) and committing.

---

## What Mento is

An **anonymous, low-friction emotional-support app**. A person in a hard moment opens it and is talking to a real human in under 30 seconds — no login, no name, no judgment. UPSC aspirants are the **first community**, not the product — communities are a *lens* the user picks in the Path tab (upsc/neet/jee/exams/life), never a gate. Mentor-led UPSC *sessions* and the UPSC *self-assessment* suite are **later modules**, not v1.

Hero experience: **anonymous 1:1 chat** — "I just need to talk."

Quality bar: international B2C, and since the 2026-07-11 rulings (DECISIONS §I) explicitly **beyond the mockups**: cinematic motion, depth, light and a living companion — in the Calm/Headspace register, never gamified, **no 3D engine, no audio**. **The user's chosen animal is the star** — after the pick, their companion (not a fixed panda) carries identity everywhere.

**When a call isn't covered by DECISIONS/PRD:** make the choice a top-tier consumer app in the Calm register would make, implement it, and record it in `PROGRESS.md → Open decisions` for founder veto. Don't block waiting for an answer; don't silently decide either.

---

## Stack (confirmed)

| Layer | Choice | Notes |
|---|---|---|
| Mobile | **Expo SDK 52** (RN 0.76, TS 5.3) + expo-router 4 | iOS + Android primary; **web = dev/test surface** (Playwright), best-effort UX. |
| Motion | **Reanimated 3.16** + **@shopify/react-native-skia 1.5** + expo-haptics | Skia 1.5 is the SDK 52 pin (v2 needs SDK 53+). Ambient SkSL aurora + motion tokens (`theme/motion.ts`). Web lazy-loads CanvasKit, falls back to a static gradient. |
| Character art | In-house SVG rig + AI-generated webp + 2.5D `Tilt3D` parallax | **PERMANENT v1 route** (DECISIONS §I.4, amended 2026-07-13 — Rive retired, no commission budget). Assets in `apps/mobile/assets/companions/`. |
| Scene art | **Lottie** — `lottie-react-native` 7.1 (native) + `@lottiefiles/dotlottie-react` (web) | Free LottieFiles assets, palette **baked** by `scripts/theme_lottie.py` (repo root). Licenses tracked in `apps/mobile/assets/lottie/README.md`. See Lottie rules below. |
| Backend | **FastAPI** (Python 3.12) | async; Pydantic v2. |
| DB | **Postgres 16** (compose locally → DigitalOcean managed) | SQLAlchemy 2.0 + Alembic migrations; matcher relies on row locks (`FOR UPDATE SKIP LOCKED`). |
| Cache | **Redis** | **rate limiting is live** — onboarding 10/h per IP, match 10/10min per user, PIN 5/15min per convo+caller (`app/ratelimit.py` + call sites; fail-open on Redis error, never silent). Presence/matching state lives in Postgres row locks, not Redis. |
| Messaging | **Stream Chat** (getstream.io) | presence/typing/read-state; **crisis scan enforced via its webhooks** (see T&S #1). Storage promise resolved — see T&S #8. |
| Payments | **Razorpay** | processor for **contributions** + later Module B session fees. **Not** membership tiers (DECISIONS §H.1). Awaiting creds — coffee screen ships transparently disabled. |
| OTP | **MSG91** | **NOT in the v1 user path**. Reserved for mentor verification (deferred Module B). |
| Analytics | **PostHog** | **wired (session 23):** anonymous client funnel via `lib/analytics.ts` (raw HTTP capture, no SDK, closed event union) — dark until `EXPO_PUBLIC_POSTHOG_KEY` is set. Never message content or PII; crisis sessions excluded from retention metrics. |
| Errors | **Sentry** | env-gated both sides (empty DSN = off): API errors-only with request bodies stripped (`SENTRY_DSN`); mobile JS-error capture (`EXPO_PUBLIC_SENTRY_DSN`) — native crash symbolication is release-build work. |
| i18n | **i18n-js** + expo-localization | EN + HI over `locales/{en,hi}.json`, typed keys (`lib/i18n.tsx`), persisted `mento.lang`, live Profile toggle; chat bodies/server Path content/personas stay untranslated. Devanagari via Noto Sans (loaded) + platform fallback. |

**Key env vars** — API (`services/api/.env`, template `.env.example`): `ENV`, `JWT_SECRET`, `ADMIN_JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `STREAM_API_KEY`/`STREAM_API_SECRET`, `RAZORPAY_KEY_ID`/`_SECRET`, `POSTHOG_API_KEY`, `SENTRY_DSN`. Mobile (`apps/mobile/.env`): `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_POSTHOG_KEY`/`_HOST`, `EXPO_PUBLIC_SENTRY_DSN`.

---

## Commands — run & verify (copy-paste)

### Run the stack (backend first, PowerShell)
```powershell
cd services/api
docker compose up -d --wait                                  # Postgres 16 :5432 + Redis 7 :6379
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.seed_listeners         # matching 503s without seeded listeners
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000   # Swagger at /docs

cd apps/mobile
npm install
npx expo start --web --port 8081                             # add -c after dependency changes
```

### Verify — run these before claiming ANY work done
```powershell
# API touched:
.\.venv\Scripts\python.exe -m pytest          # 137 passing as of session 23 — pytest is the truth, not this number
.\.venv\Scripts\python.exe -m alembic check   # model/migration sync — CI fails without it
.\.venv\Scripts\python.exe -m scripts.seed_listeners   # pytest TRUNCATES dev-DB listeners — always re-seed after

# Mobile touched:
npx tsc --noEmit                              # the ONLY JS gate — there is no ESLint/Prettier in this repo

# Flow touched (E2E, web): backend :8000 seeded + Expo web :8081 running, then
NODE_PATH=<path-to-global-playwright>/node_modules node e2e/<flow>.e2e.js
```
E2E specs are plain Node scripts in `apps/mobile/e2e/` (not `@playwright/test` — Playwright is **not** a project dependency; see `e2e/README.md`). They hard-code viewport **390×844**, headless chromium, and **assert 0 page errors**; `path-communities.e2e.js` also runs a `reducedMotion: 'reduce'` context. New user-facing flows get a new `.e2e.js` in the same style.

### Gotchas that look like bugs
- Matching returns **503** ⇒ listeners table is empty (pytest truncated it) — re-seed, don't debug the matcher.
- `test_matching_concurrency.py` needs Postgres; it auto-skips on the SQLite fallback — a skip there is not a pass.
- Lottie on web: `lottie-react-native` delegates to dotlottie and ignores `style` — set **both** `style` and `webStyle`; unmount during route teardown crashes ("ImageData width 0") — guard with a `leaving` state (pattern: `app/index.tsx`).
- Outside dev the API **refuses to boot** on default `JWT_SECRET` or missing Stream creds (`app/main.py` invariants) — that's deliberate, not a bug.
- Crisis webhook live-testing needs a tunnel: `cloudflared tunnel` + `scripts.configure_stream` (README).
- **Native/Expo Go (session 22):** `apps/mobile/.npmrc` (`legacy-peer-deps`) + `apps/mobile/patches/` (patch-package, postinstall) hold the device-compat fixes — **never remove them**; without them the app crashes at boot on-device (duplicate safe-area registration, Reanimated Pressable invariant, Stream/teleport native modules absent from Expo Go). Metro bundles stream-chat's **`src/` TS** (its `react-native` entry field), not `lib/` — patch src, and verify fixes in the served bundle, not just on disk.
- **RN `<Modal>` renders blank on Android under the new arch** (presents natively, content invisible = app looks frozen; back dismisses it). Use a screens-backed `presentation: 'transparentModal'` route instead (pattern: `app/start-fresh.tsx`).
- Phone testing: Expo Go **2.32.20** (SDK 52) sideloaded from Expo's GitHub releases (Play Store Expo Go is newer-SDK-only); API must run `--host 0.0.0.0` with `EXPO_PUBLIC_API_URL` on the LAN IP.

---

## Repo layout (verified 2026-07-14)

```
mento/
  apps/mobile/
    app/                    expo-router: index (landing, live Lottie hero) · onboarding/ (index = OnboardingJourney;
                            age|email|companion|connecting|ready are legacy deep-link stubs) · chat/[id]
                            · (tabs)/ chats|path|journals|profile (+ mentors: hidden-but-routable via Browse)
                            · journal/[channel] · mentor/[id] · reflection · coffee · start-fresh (transparentModal)
                            · listener-apply (become-a-listener form, member-flow) · apply (public
                            listener-recruitment landing page, no session needed — console.agentin.chat/apply)
                            · listener/ (web-only console) · admin/ (web-only dashboard)
    components/
      art/                  Logo, Panda, AnimatedPanda rig, Companion(s), ReactiveCompanion (idle states:
                            curious/joy/sleepy), Scenes, SceneTile, LottieTile, PersonaAvatar
      motion/               AmbientBackground(.web), AuroraCanvas (SkSL), PandaStage, Entrance, StepTransition,
                            useBreathing, ambientLift, StaticAmbient, Tilt3D/TiltCard (2.5D), ConnectionConstellation, SkyMotes
      onboarding/           OnboardingJourney (step machine) + steps/ + StepScaffold
      chat/                 ChatScreen(.web), CrisisCard, ConversationOptions + options/
      listener/             ListenerConsole(.web), ListenerChatScreen(.web), WebOnlyNotice
      admin/                AdminConsole(.web) + panels/ ×7
    theme/                  tokens.ts · motion.ts · companion.ts · ThemeProvider (see Design tokens)
    lib/                    api.ts, adminApi.ts, listenerApi.ts (typed clients) · session/adminSession/listenerSession
                            · streamClient/listenerStreamClient · haptics · useReducedMotion(.web) · onboardingDraft
                            · useSessionGuard · format
    assets/                 lottie/ (5 themed animations + license README) · companions/ (fluent/ SVG sources +
                            convert.js, generated/ webp incl. panda-poses, registry.ts) · scenes/ (webp empty-states)
    locales/                en.json · hi.json (typed keys via lib/i18n.tsx; EN is canonical)
    e2e/                    connecting-experience.e2e.js · path-communities.e2e.js · listener-apply.e2e.js
                            · analytics-dark.e2e.js · hindi-core-loop.e2e.js · README.md
    patches/ + .npmrc       Expo Go device-compat (patch-package via postinstall + legacy-peer-deps) — do not remove
  services/api/
    app/                    routers/ (onboarding, match, conversation, stream_hooks, moderation, journals, listeners,
                            listener_console, admin_console, safety, paths, health)
                            · services/ (matching, stream, safety, crisis, audit, persona(+data), paths(+data))
                            · models/ (user, listener, conversation, journal, reflection, moderation, safety,
                            contribution, request, admin, enums, mixins) · schemas.py · security.py · ratelimit.py
                            · config.py · db.py
    migrations/             7 forward-only Alembic revisions (alembic check keeps models in sync)
    scripts/                seed_listeners · configure_stream · issue_listener_token · issue_admin_token
    tests/                  pytest — 12 files / 54 tests: matcher concurrency, crisis-webhook proofs, security
                            hardening (age gate, wipe, PIN lockout, scan ownership), paths, admin, listener console
    docker-compose.yml      Postgres 16 + Redis 7
  deploy/                   do-app.yaml (DigitalOcean App Platform spec; runbook in docs/DEPLOYMENT.md) ·
                            docker-compose.prod.yml + deploy.sh + deploy-console.sh + backup-postgres.sh +
                            nginx/{mento-api.conf.template,mento-console.conf} (self-managed VPS path — session 28
                            LIVE at api.agentin.chat + console.agentin.chat/{admin,listener}; runbook docs/DEPLOYMENT_VPS.md)
  scripts/                  repo-root: sample_mockup_colors.py · theme_lottie.py (Lottie → Mento palette)
  docs/                     PRD.md · DECISIONS.md (WINS) · ALIGNMENT.md · MOCKUP_INVENTORY.md · MASCOT_ASSETS.md
                            · UX_REVIEW_2026-07-13.md · DEPLOYMENT.md (DO App Platform) · DEPLOYMENT_VPS.md
                            (Hostinger, self-managed — live prod) · Mockups/ · superpowers/{plans,specs}/
                            (admin dashboard, landing enhance, path communities)
  .github/workflows/        api-ci.yml (compose → alembic upgrade+check → pytest; path-filtered to services/api)
  README.md  CLAUDE.md  AGENTS.md  PROGRESS.md
```

---

## Coding conventions

- **TypeScript** everywhere in mobile; `strict: true`. No `any` without a `// reason:` comment — the same `// reason:` convention documents *any* intentional rule-break (there is no linter to suppress; the comment is for humans).
- **Python**: type hints required; `ruff` + `black` style; functions do one thing.
- Components: function components + hooks. One component per file. Co-locate styles.
- **Design tokens, never raw hex** in components — consume via `useTheme()`. Never raw durations — consume `theme/motion.ts`.
- **Typed API clients only** — extend `lib/api.ts` (member), `lib/listenerApi.ts` (console), `lib/adminApi.ts` (dashboard). Never hand-write `fetch` in a component. Server side: Pydantic models in/out. (`lib/analytics.ts`'s fire-and-forget fetch is the sanctioned third-party exception.)
- **User-visible strings via `useI18n().t()`** — never hardcoded literals in components (EN canonical in `locales/en.json`, typed keys). **Analytics via `lib/analytics.ts` only** — allowlisted closed event union, no PII ever, no crisis events.
- **Web/native splits** use the `.web.tsx` convention (`AppProviders*`, `ChatScreen*`, `ListenerConsole*`, `AdminConsole*`). Listener console and admin dashboard are web-only — native gets `WebOnlyNotice`.
- **Motion rules (non-negotiable):**
  - Timings/easings from `theme/motion.ts` — never raw durations/beziers in components.
  - Animate **transform and opacity only** — never layout props (60fps mid-Android is a hard target).
  - **Manual shared values, never Reanimated `entering=`/`exiting=`** (flaky on react-native-web, our test surface).
  - Every animation consults `useReducedMotion` — reduced = ≤150ms opacity-only, loops off, shader frozen, **Lottie replaced by its static fallback** (`LottieTile`→`SceneTile`, hero→coded scene). The flow must be fully usable with all motion stripped.
  - Calm register: no overshoot springs, ≤3 simultaneous movers, breathing-tempo idles. No Skia blur/backdrop on Android.
- **Lottie rules:** only free/licensed assets — record source + license in `assets/lottie/README.md`; every asset is re-themed through `python scripts/theme_lottie.py <in> <out>` before committing (it remaps fills/strokes/gradients onto Mento tokens by HSL role); the baked palette is **static** — Lottie art does not follow the companion accent (known, accepted trade-off); always provide a reduced-motion still.
- Naming: `snake_case` (Python/DB), `camelCase` (TS), `PascalCase` (components/types).
- Migrations are forward-only and reviewed; never edit a shipped migration. `alembic check` in CI enforces model↔migration sync.
- Tests before merge for: matching, routing, crisis-scan, payments, age-gate, paths, listener-console and admin auth/scoping.
- Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`); each unit proven (the Verify commands above) before starting the next.

---

## SCOPE

### v1 — build now (Module A: anonymous emotional-support chat, polished light-mode)
1. **Onboarding** — cinematic single-route journey (landing → DOB age-gate → optional email → growth-companion → ready → connecting → chat) over a persistent aurora sky + living companion. D/M/Y picker, age computed server-side, email truly skippable.
2. **Anonymous identity** — auto-assigned `[Evocative] [Nature]` persona for **both** sides. No real names/photos/"Verified" badges in v1 chat.
3. **Real-time 1:1 chat** — text + emoji, instant send, typing indicator, read state. Clean/spare, not a busy messenger.
4. **New-chat routing** — **General** (next-available match) + **Personal** (pick a mentor → intro → request → listener inbox). Topic chips lean life/emotional.
5. **Mentor/listener discovery** — list + filters, profiles (no star ratings). Anonymous personas in v1. Reached via Browse (Mentors tab is hidden-but-routable since the Path tab landed).
6. **Conversation controls** — Lock (PIN), Panda Mask, Panda Pause, End + Panda Wipe (honest server delete), Report/Block, Support-the-team.
7. **Save-to-journal from chat** — long-press/tap a mentor message → Mentor Notes. The core talk→action loop.
8. **End-of-conversation reflection** — private energy slider. **No points/XP.** Decoupled from money.
9. **Journals** — hub + Mood/Finance/Gratitude/Mentor Notes; AI Journal Assistant pending the LLM decision.
10. **Crisis & safety flow** — real, server-side (see Trust & Safety). Non-negotiable.
11. **Contribution ("coffee")** — transparent, opt-in, from the menu; never inside a live conversation; supports the *team*.
12. **Design system** — light-mode indigo/lavender + the motion token system; **companion-is-the-star** theming (accent + animal follow the user's choice everywhere).
13. **Minimal listener console (DECISIONS §I.6)** — web-only, per-listener token-link auth: own conversations, real-time reply, accept/decline own Personal requests, online/away toggle. Nothing more.
14. **Admin dashboard** — web-only `/admin` (spec `docs/superpowers/specs/2026-07-13-admin-dashboard-design.md`), owner/helper token-link auth (per-request revocation), full audit trail. Seven tabs: Overview cockpit · Safety review (audited read-only live conversation view — bodies never stored) · Moderation (+ one-click suspend) · Listener management (replaces the CLI scripts) · Contributions stub · Health (incl. silent-webhook-death detector) · Admins + audit. Bootstrap: `python -m scripts.issue_admin_token --owner --name "<n>"`. **Privacy policy must disclose safety-staff conversation access before launch.**
15. **Path (Communities) — SHIPPED session 17, awaiting DECISIONS §J ratification** — Pathfinder → community lens (upsc/neet/jee/exams/life) with journey stages, warm-up prompts and seasonal cards, all server-driven (`GET /paths/tree`, `GET/PUT/DELETE /paths/me`, content in `services/paths_data.py`). Prompt taps pre-fill the composer via `?starter=` — **never auto-send**. Community is the strongest **soft** matcher preference — it must never strand a user unmatched. Tabs: **Chats · Path · Journals · Profile**. Community + stage are coarse, optional, clearable (privacy-policy note pending).
16. **Become-a-listener funnel — SHIPPED session 22, awaiting DECISIONS ratification** — Profile → application (motivation, communities, availability, optional email, `mentor_interest` Module B staging flag, hard-gated "not therapists" pledge) → admin Applications queue in the Listeners panel (approve mints a real listener + audit row; decline stores an admin-private reason) → in-app status card (approved reveals the private console link; declined can reapply after a 30-day server-enforced cooldown). Emails stored, not sent (no provider yet).
    - **Public acquisition channel — SHIPPED session 28**: `console.agentin.chat/apply`, a standalone landing page needing no app install or existing session. It mints a throwaway anonymous `User` via the existing, unmodified `POST /onboarding/start` age gate (18+, same DOB math as real onboarding), then submits through the **unchanged** `POST /listener-applications` flow — zero backend changes. Shared form fields live in `components/ApplicationForm.tsx`, used by both this page and the member-flow `listener-apply.tsx`. Accepted limitation: the 3/24h per-user rate limit and the 30-day reapply cooldown are keyed on `user_id`, and a fresh anonymous user is minted per public submission — so a declined/rate-limited public applicant can trivially resubmit by reloading the page. Not solved (admin review already screens); the IP-based 10/hour `onboarding/start` limiter is the only cap on that specific path.

### v2 — deferred (spec separately, don't build by default)
- **Module B**: mentor real profiles, paid 1:1 sessions (+~10% platform fee), full mentor portal, MSG91 verification.
- **UPSC self-assessment suite** (Mirror / Knowledge Assessment / Challenges / growth dashboard). **Defer.**
- **UPSC Journey** study tracker · **Community** tab · account creation as a gate · listener reputation rank · moderation console (Module C).

### Out (for now)
- Bank-notification expense capture (PRD §13). Group sessions. The ₹399/599/999 **membership tiers** and any hidden/dark-pattern payment. Commissioned mascot art (DECISIONS §I.4: in-house rig is permanent).

---

## Definition of Done

**Universal — every change, before you say "done":**
1. The Verify commands for the layers you touched pass (see Commands) — pytest green, `alembic check` clean, `tsc --noEmit` clean.
2. Any touched user-facing flow driven end-to-end in the browser at 390×844 with **0 console/page errors** — once normally, once under `reducedMotion: 'reduce'` (flow must complete, static).
3. Listeners re-seeded if pytest ran; new behavior has a test if it's on the tested-before-merge list.
4. Conventional commit made; `PROGRESS.md` updated before the session ends.

**Per-feature:**
- **Onboarding**: cold-launch → live chat ≤ 30s on mid Android (currently ~5s on web); journey deep-links guard on the draft; under-min-age blocked server-side; email truly skippable; companion choice persisted & themes the app live.
- **Motion**: every animation uses motion tokens, transform/opacity only, respects reduced motion (Playwright `reducedMotion: 'reduce'` run stays static and completes); first frame is always the static gradient; 0 console errors.
- **Chat**: send→delivered p95 < 500ms; typing + read state correct; reconnect < 3s, no lost/dup messages; save-to-Mentor-Notes works; persona names render on both sides.
- **Routing**: General matches an available listener; Personal lands in that listener's inbox with accept/decline; no double-assignment under concurrency (tested).
- **Path**: community/stage changes persist server-side; clearing works; matcher preference stays soft (a user with a rare community still matches); starter prompts never auto-send.
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
6. **Minimize PII; policy must match reality (PRD §14).** Path community + journey stage are deliberately coarse, optional and clearable — must be disclosed in the privacy policy alongside safety-staff conversation access (launch gate).
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

**The code is the source of truth**: colours/type/space/elevation in `apps/mobile/theme/tokens.ts` (pixel-calibrated against the mockups via repo-root `scripts/sample_mockup_colors.py` — warm-cream `bg #FDF8F5`, ink `#1D2142`, default accent/brand `#5847D6`, `accentSoft #8177C9`, pastel `wash.*`; fonts Nunito + Lora). Per-user companion accents in `theme/companion.ts` — **7 colors** (purple/blue/green/pink/orange/teal/indigo), default `purple`, layered live over `brand*` by `ThemeProvider` (`useTheme()` exposes `companionColor`/`setCompanionColor`). **Motion tokens** in `theme/motion.ts`: `duration` 200/350/500/700, calm `easing`, `spring.calm`, 80ms `stagger` unit, 5.2s `breathe`, slow `drift`, and the `character` vocabulary (sway/greet/celebrate/comfort/tap/curious/joy/sleepy) that drives `ReactiveCompanion`. Components consume tokens — never raw hex, never raw durations.

Exception by design: Lottie scene art carries a build-time-baked palette (via `scripts/theme_lottie.py`) and does not re-tint with the companion accent.

Mood/finance charts may use a multi-hue categorical scale — define as a separate `chart.*` token group when needed, not reused for UI chrome.

---

## Working standards — the ritual skills (`.claude/skills/`)

Six project skills encode the workflows this repo repeats every session. **Invoke them instead of improvising**; if reality diverges from a skill, fix the skill in the same commit (same rule as this file).

| Moment | Skill |
|---|---|
| Session start / servers down / 404s / 503s / stuck ports | **mento-stack** |
| Before claiming ANYTHING done, fixed, or passing; before any commit | **mento-verify** |
| Proving a flow in the browser; e2e authoring; e2e 429/503/flake | **mento-e2e** |
| Session wrap-up; logging shipped work; "update progress" | **mento-session-end** |
| Adding/theming animated art assets | **mento-lottie** |
| Live-testing crisis enforcement / Stream webhooks | **mento-crisis-webhook** |

Standing rules the skills assume: the founder's product calls get implemented then logged in `PROGRESS.md → Open decisions` (never silently decided, never blocked on); gotchas that cost >15 min get written into the relevant skill or this file the same session; commit counts, test counts, and layout claims in docs are treated as hints — the repo is the truth.

**External skills are advisory, this file wins.** The installed third-party skills (`gsap-*`, `high-end-visual-design`, `imagegen-frontend-mobile`, `redesign-existing-projects`) are reference taste/technique — where they prescribe fonts, colors, shadows, spacing, or animation defaults that differ from Mento's tokens, motion rules, or Calm register, **Mento's design system wins, always**. GSAP is DOM-only: never propose it for app screens (Reanimated + Skia is the stack); it's only ever a candidate for genuinely web-only surfaces, and even there prefer the motion tokens.

---

## Docs drift to reconcile (as of 2026-07-14)

- Privacy policy (launch gate): safety-staff conversation access + community/stage data note. **Draft shipped** `docs/PRIVACY.md` (session 29) — still needs founder/legal sign-off before it's the *published* policy.
- Helplines: re-verified Tele-MANAS 14416 / KIRAN 1800-599-0019 (session 29) — see `docs/PRIVACY.md` sourcing.
- **Stack table needs a push-notifications / OTA row** (session 25–26): `expo-notifications` + `expo-device` (device registration only, `services/api/app/routers/notifications.py` + `lib/pushNotifications.ts`) and `expo-updates` (shake-to-update `lib/useShakeToUpdate.ts` + manual "Check for updates" in Profile). EAS `projectId`/`owner` **are** now set (`app.json` `extra.eas` + `owner: geekspace`), but the founder chose **local build + self-hosted OTA to avoid EAS cloud cost** — see `docs/ANDROID_BUILD.md`. The one gap for live shake-update is an `updates.url` block in `app.json` pointing at a self-hosted server (deferred to when the server exists; APK builds + installs fine without it, shake just inert). No product send-trigger decided.
- **In-chat AI landed (session 26)** — add Stack rows: **local PII redaction** (`app/services/moderation.py`, regex + optional Presidio, on the before-send message path, `pii_redaction_enabled`) and **opt-in journal note-sorting** (`app/services/notes_ai.py` Gemini Flash, `gemini_api_key`, dark by default, `POST /journals/organize` + `/journal/organize` screen). New env vars: `GEMINI_API_KEY`; optional `requirements-ml.txt` for Presidio NER.
- **Prod is now live (session 28)** — self-managed Hostinger VPS, `https://api.agentin.chat`, full runbook in `docs/DEPLOYMENT_VPS.md`. Stack table's Backend/DB/Cache/Messaging rows describe *what* runs but not *where* — needs a Hosting/Deployment row (or a pointer) once the DO-App-Platform-vs-VPS story is settled as more than "two parallel docs." Mobile still points at localhost by default; `EXPO_PUBLIC_API_URL=https://api.agentin.chat/api/v1` is the prod value once the app is built against it.
Clear an item from this list when the underlying doc is updated — then delete the line.

---

## How to resume
Read `PROGRESS.md` first — latest Done / In-progress / Next / Open decisions / How to resume. Full run book in `README.md`; exact commands above.
