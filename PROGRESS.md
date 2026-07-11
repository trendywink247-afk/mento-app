# PROGRESS.md — Mento

> Restart-from-anywhere log. Newest entry on top. Each entry: Done / In-progress / Next / Open decisions / How to resume.

---

## 2026-07-11 (session 12) — Docs truth pass, companion-is-the-star, mascot memo, LISTENER CONSOLE ✅

**Context (founder feedback + rulings, recorded in DECISIONS §I):** the coded SVG panda misses the mockups' bar → professional reactive assets, research-gated (§I.4); **the chosen animal must be the star everywhere** (§I.5); the mentor side didn't exist (listeners had no auth/list/reply — only the admin-token stand-in) → **minimal listener console ships in v1** (§I.6); core MD files were stale → full rewrite.

**Done (11 commits, each proven):**
- **Docs truth pass** (`3ee08d1`): README rewritten from scratch (true status, run book incl. crisis-webhook tunnel, env tables, CI); CLAUDE.md refreshed (Skia/motion stack, motion rules, SCOPE #13 console, both-sides anonymity T&S #7, motion restraint #11); DECISIONS gains **§I** (7 rulings); ALIGNMENT §6+§7 addendum. Zero stale-claim grep hits.
- **Companion-is-the-star** (`dfa0f48`): PandaStage swaps (fade-through) to the chosen animal the moment it's tapped; animal persisted (`mento.companion_animal`, cleared by Start fresh); Profile card shows "[Colour] [Animal]". Proven: fox on the stage/connecting/profile.
- **Mascot memo** (`f2bd299`, `docs/MASCOT_ASSETS.md`): verified — **no off-the-shelf 6-animal set exists** (best free: 5/6 faces-only Lottie pack); recommendation = free Lottie interim + **commission a reactive Rive set ($2.5–6k, 4–8 wks)**. ⏳ **Founder decision gate.**
- **LISTENER CONSOLE** (`fd91c19`…`7c62f2a`, 6 commits): the mentor side is real —
  - API: role-claimed listener JWT (30d; `current_user_id`/`current_listener_id` mutually reject; suspension revokes per-request), accept/decline extracted to `services.matching` (shared row-locked path; admin stand-in unchanged), `/listener/me` endpoints (profile+stream token, online/away status that gates matching, conversations w/ member personas, own pending requests, accept 404-not-mine/409-capacity), `scripts/issue_listener_token` prints a shareable link. Conftest TRUNCATE gains `conversation_requests`. **Suite 28 passed** incl. a racing-accepts concurrency test.
  - Mobile (web-only; native = notice stub): `/listener?token=` console (token stripped from URL/history, localStorage session, distinct `mento.listener.*` keys, **dedicated Stream client instance** — the user singleton's `connectUser` conflict is the known trap), requests inbox w/ accept/decline, conversations list, availability pill; `/listener/chat/[id]` trimmed chat as the listener identity — member persona only, **CrisisCard extracted + rendered on BOTH sides**.
  - **Proven (two Playwright contexts, real backend + Stream):** member onboards → messages → token link authenticates → listener sees the message → **replies delivered LIVE to the member** → personal request accepted from the console → away/online toggle → bad token = designed error state. 0 page errors.

**Gotcha re-confirmed:** a stale uvicorn (started before new routers) 404s new endpoints — restart :8000 after adding routers. Expo route typegen needs a dev-server restart to pick up new `app/` dirs.

**Art upgrade (same day, `95a50aa`):** GitHub sweep (verified per-file + per-LICENSE) found **Microsoft Fluent Emoji (MIT)** — the only source with all six animals in one consistent soft 3D-shaded style (the mockups' register). Color SVGs vendored (`assets/companions/fluent/`, ~180KB, LICENSE included), rendered via SvgXml on the ReactiveCompanion rig. Priority: Lottie override > Fluent > retired hand-drawn. Rejected on licence: OpenMoji (share-alike), unlicensed mirrors, Telegram stickers; Noto animated Lottie only covers 4/6.

**Amended (same day):** founder has **no Rive specialist to commission** → the **in-house coded reactive rig is the v1 mascot route** (`30ff16d`): `ReactiveCompanion` gives all six animals the brief's full state vocabulary in code — desynced idle (sway 8.6s × breathe 5.2s), greet nod, research-grounded gentle hop (~800ms, plush squash k=0.6), comfort lean (present-not-drooping, T&S-safe), tap-react (<100ms + haptic). Wired: picker greet, matched-moment celebrate, tappable ready-arch/profile companions. Playwright-proven incl. reduced-motion stillness. The commission brief stays on file for whenever a specialist is found; the Lottie registry stays as an optional drop-in.

**Open decisions:** ~~mascot asset route~~ → **RESOLVED (founder): staged Rive commission + free Lottie interim.** Commission brief ready to send (`docs/MASCOT_COMMISSION_BRIEF.md`); `Companion` abstraction + Lottie pipeline shipped (`841271d`, deps lottie-react-native 7.1.0 + @lottiefiles/dotlottie-react; pipeline Playwright-proven with a real Lottie, SVG fallback intact). **Founder to-do (10 min):** download the six free Lottie JSONs per `apps/mobile/assets/companions/README.md` (needs a free IconScout account) and flip the registry entries; **and send the commission brief** to a Rive specialist (RiveAnimator / Fiverr Pro links in MASCOT_ASSETS.md). LLM for the Journal Assistant still open (carried).

**Next:** 1) founder picks the mascot route → integrate behind a `Companion` component; 2) carried backlog: release-build Android perf gate + Maestro (device needed), Stream secret rotation + stable webhook URL (founder), Razorpay creds. For a listener demo: `python -m scripts.issue_listener_token --name "<persona>"` → open the printed link.

**How to resume:** backend `docker compose up -d` → alembic → seed → uvicorn :8000; mobile `npx expo start --web --port 8081`. Playwright scripts: `C:/tmp/playwright-test-{star,console}.js` + `/tmp/playwright-test-*.js` from session 11.

---

## 2026-07-11 (session 11) — Cinematic onboarding: the "movie-like" motion phase, leg 1 ✅

**Context (founder decisions this session):** exceed the mockups, not just match them — **cinematic motion everywhere, NO 3D engine** (the Calm/Headspace/Finch register; a full 3D app would break 60fps/<2s cold start/<40MB/the calm ethos); **onboarding journey first**; **visual + haptics, no audio**. Research verified: shared-element transitions are NOT production-viable on SDK 52 + expo-router → continuity comes from **one onboarding route** with a persistent ambient canvas + persistent mascot. Plan: `~/.claude/plans/in-which-folder-are-floofy-pony.md`.

**Done (6 commits, each Playwright-proven at 390×844, tsc clean, 0 console errors):**
- **Motion foundation** (`4ee6325`): `theme/motion.ts` tokens (calm durations/easings/spring/stagger/breathe), `components/motion/` primitives — `Entrance` (staggered fade+rise), `StepTransition` (crossfade), `useBreathing` — all **manual shared values** (`entering=` layout animations are flaky on RN-web), transform/opacity ONLY; `lib/haptics.ts` vocabulary (tick/advance/success, HIG-meaningful, web no-op); `lib/useReducedMotion(.web).ts` — every primitive degrades to ≤150ms opacity-only.
- **One journey route** (`de72d31`): onboarding collapsed into `app/onboarding/index.tsx` → `OnboardingJourney` step machine (age→email→companion→ready→connecting) so background+mascot never unmount. `?step=` URL mirror (replace semantics, skipped on first render — navigating pre-root-layout throws), deep-link guard (no DOB in draft → snap to age), old routes = Redirect stubs, hardware-back/chevron step backward, fade seams for onboarding+chat in the root Stack. **API flow byte-identical**; ConnectingStep fires on `active`, not mount. Steps restore prior picks from the draft.
- **Ambient aurora** (`f15379e`): `@shopify/react-native-skia` **1.5.0** (the SDK 52 pin, +~3-5MB native). One full-screen SkSL shader (3 blobs, ~45-90s orbits, smoothstep falloffs — **no Skia blur**), palette derived from companion accent; **picking a colour washes the whole sky over 900ms** (proven by pixel diff). Static SVG gradient paints the first frame (cold-start guard) and is the permanent fallback; web lazy-loads CanvasKit from CDN at idle (fails → gradient stays, warn not error). Reduced motion freezes the clock (proven frame-identical over 2s).
- **Living panda** (`17f3e89`): `AnimatedPanda` — Panda.tsx re-layered into stacked SVGs (body+cape/arm/head/eyes) animated only via container transforms: randomized blink, ±2° head sway, wave on trigger. `PandaStage` mounted once at journey level: glides between per-step anchors, breathes, waves on greetings, happy-dips on colour pick, sways on connecting, hands off to the in-arch breathing companion on ready (panda choice gets the full rig; other animals get CompanionArt+breathing). Entrance cascades on all five steps; connecting guidelines cascade slowly (wait entertainment). Proven: panda frames differ over 3s, identical under reduced motion.
- **Landing cinematic** (`1cbdd4f`): same ambient sky as the journey (one continuous shot across the route fade), breathing logo, headline rises line-by-line ("understands." last), mountains drift ±8px/~40s (drawn 24px wider — no exposed edge), CTA = 250ms hero fade then route fade. Returning-user redirect regression-proven.
- **Matched moment** (`8e6f9fb`): match success → success haptic, panda celebration, sky lifts toward accent (`uLift` uniform via `makeMutable` singleton), "Found someone for you 💜" — **hard-capped 900ms**, then fade into `/chat/[id]`. Reduced motion navigates instantly. Proven incl. **error/retry** (first match call aborted → error state → retry → chat, 9.5s total; normal pass 5.3s — the <30s promise has huge headroom).

**Descoped (logged, deliberate):** per-step shader mood, mountains parallax layer-split, ConnectingScene dashed-line pulse, email envelope tilt-settle micro-beat. Browser-back exits the journey to landing (web = best-effort, documented in code).

**Open items:**
1. **Release-build perf gate NOT yet run** (no Android device/emulator this session): `npx expo run:android --variant release` + `adb shell dumpsys gfxinfo` through a full onboarding pass, record numbers here; APK size check (<40MB incl. Skia). Contingency if the shader is hot on mid-Android: half-res canvas + scale(2) (documented in AuroraCanvas).
2. **Maestro native verification** now covers the new motion too (transformOrigin behaviour, Skia on device, haptics vocabulary, keyboard-vs-transition).
3. **Rive mascot** stays the logged future upgrade (needs dev build + a custom web adapter; the SVG rig is the v1 answer).
4. Carried from session 10: AI Journal Assistant (LLM decision), Razorpay creds, Stream secret rotation + stable webhook URL.

**How to resume:** backend `docker compose up -d` → `alembic upgrade head` → seed → uvicorn :8000; mobile `npx expo start --web --port 8081` (`-c` after dep changes). The journey is `components/onboarding/OnboardingJourney.tsx`; motion primitives in `components/motion/`; motion tokens in `theme/motion.ts`. Playwright scripts from this session: `/tmp/playwright-test-{journey,aurora,panda,landing2,matched}.js`.

---

## 2026-06-11 (session 10) — Phase 5 closed out: log recovery, Start fresh, inventory erratum ✅

**Context:** session 9 hit a rate limit after the last Phase 5 commit but *before* logging it — this entry recovers that log, then closes the two leftover Phase 5 items.

**Phase 5 — new surfaces (committed end of session 9, logged here)**
- **My Chats** (#54/55, `889e12a`): list-conversations endpoint, previews, PIN gate on locked chats, New Chat.
- **Mentors** (`2578151`): GET /listeners (availability-sorted, blocked excluded), Personal requests (intro ≤160, idempotent), **admin-token accept/decline as the mentor-inbox stand-in until Module B** — accept row-locks capacity and opens the conversation via the shared `open_conversation()`. Mobile: Mentors tab → profile → intro composer → request-sent. Proven live: browse → request → admin accept → conversation in My Chats. Suite 21 passed.
- **Journals** (`4470f34`): generic POST/GET `/journals/entries` (mood|finance|gratitude) + `/journals/summary`; hub per mockup (AI-assistant card honestly "Coming soon" pending the LLM decision) + one parameterized `/journal/[channel]` surface. Proven live; suite 22 passed.
- **Profile** (`3c8fb96`): persona identity, live colour switcher, support/about rows.

**Done this session**
- **App run for founder demo:** Docker (was down) → migrations → re-seed listeners (pytest truncation) → uvicorn :8000 + Expo web :8081; Playwright smoke clean. Crisis-webhook tunnel *not* configured this session (enforcement needs `cloudflared` + `configure_stream` per session-6 notes).
- **"Start fresh" on Profile** (`1a7b415`): confirm modal (wave panda, honest no-way-back copy) → resets accent → `clearSession()` → landing. Fills the demo gap: there was no logout/reset. Playwright-proven: cancel keeps session; confirm leaves zero `mento.*` keys; reload stays on landing.
- **MOCKUP_INVENTORY erratum** (`368e8f5`) — the deferred mis-mapping fix, done properly: re-verified **29/64 mockups by pixel** and found the catalog was mis-attributed in three runs (uncataloged Journals hub / Mentors directory / Assessment Complete screens + three duplicate-sighting entries). Every entry now names its pixel-verified file; checked bijective (64 headings ↔ 64 files). New entries #65–#67.

**Next (the build-able backlog):**
1. **AI Journal Assistant** (#29) — blocked on the LLM decision (model/provider/cost; recommend a founder call, then it's a contained unit: conversational logging into Mood/Finance).
2. **Razorpay contribution wiring** — blocked on creds; coffee screen ships with methods transparently disabled.
3. **Native device verification** (Maestro, iOS/Android) — stream-chat-expo UI, options sheet, haptics, keypad.
4. **Stream secret rotation** (founder, dashboard) + a stable webhook URL for staging (replace per-session cloudflared).

**Open decisions:** LLM for the Journal Assistant (provider, on-device vs API, cost ceiling).

**How to resume:** backend `docker compose up -d` → `alembic upgrade head` → seed → uvicorn :8000; mobile `npx expo start --web --port 8081`; crisis-enforcement live-testing additionally needs the tunnel + `python -m scripts.configure_stream <url>`.

---

## 2026-06-11 (session 9) — Phase 0: mockup-fidelity foundation ✅

**Goal:** the unlock layer for the mockup-fidelity overhaul (plan: `~/.claude/plans/parsed-orbiting-wadler.md`) — calibrated tokens, real typography, primitives, a vector art system, and the tab shell. All committed.

**Done this session**
- **Token calibration (committed):** sampled the mockup JPEG pixels (`scripts/sample_mockup_colors.py`) → warm-cream `bg #FDF8F5`, `bgLavender` ritual variant, purple `#5847D6` accent, `wash.*` pastel icon-circle group, calibrated `elevation` shadows. `type` ramp now two families.
- **Typography (committed):** Lora (serif display — hub titles, persona names) + Nunito (rounded sans body) via `@expo-google-fonts` + `useFonts` in `_layout.tsx`; splash held until loaded. Family-per-weight convention (Android-safe).
- **Primitives (committed):** `Card` (borderless, radius 22, soft shadow), `IconBadge` (pastel-circle icon, 5 washes), `PrimaryButton` gains `tone: ink` (navy onboarding CTAs), trailing →/›, leading icon, `link` variant.
- **Vector art system (committed):** `components/art/` — `Logo` mark+lockup, `Panda` poses (wave/sleeping/excited/coffee/sad/broom/shield), `CompanionArt` ×6 animals, `Scenes` (mountains/connecting/chat-bubbles), `PersonaAvatar` (deterministic nature-gradient hashed from persona name — anonymity-safe stand-in for the mockups' photo landscapes).
- **Native chat re-theme (committed):** the stale uncommitted re-skin targeted Stream Chat v5 theming (removed API, didn't compile) — redone via the v9 semantics. Logic untouched.
- **Tab shell (committed, verified):** `app/(tabs)/` — **Chats / Journals / Mentors / Profile** (v1 tab set; Home/Mirror/Community variants deferred), custom bar per mockup #7 (white rounded-top, active icon in accentTint pill). Chat detail stays pushed above tabs. **`/` now routes returning users (stored session) → My Chats; fresh → landing** — Playwright-proven both ways at 390×844, 0 console errors. Journals/Mentors/Profile are designed empty states until Phase 5.

**Phase 1 — onboarding pixel pass ✅ (one commit per screen, each Playwright-screenshotted at 390×844 against its mockup, tsc clean, 0 console errors)**
- **Landing** (#2): centered LogoLockup, 3-line headline w/ soft-lavender "understands." (new `accentSoft` token, sampled), ink CTA w/ chat icon, full-bleed mountains.
- **Age gate** (#3): 4-line "anonymous." headline, shield + lock reassurance, `DobPicker` → single tinted card (chevron/value/label columns; invisible accessible Picker overlay keeps web `<select>` + native wheel — proven interactable). D/M/Y semantics + server gate untouched. *(Mockup's wrong "Years/Months/Year" labels stay corrected.)*
- **Email** (#4): centered, envelope IconBadge, icon-in-field, lock note, ink Continue →, "or" divider, Skip link. Honest recovery copy kept (not the mockup's marketing line).
- **Companion** (#58): lavender ritual bg (`Screen bg=lavender` + white-circle back), animal/colour cards w/ check badges, numbered section headers, "Can't decide?" card w/ outlined **Surprise Me** (now selects visibly + re-accents live; user still confirms — polish call). Live re-accent proven (green walk-through).
- **NEW `ready.tsx`** (#59): check badge, companion art in lavender arch, "You chose [Colour Animal]" serif, affirmations card, Enter My Space ›. **Flow rewired: companion → ready → connecting.**
- **Connecting** (#5): two-windows scene, 5 guideline rows w/ pastel badges (mockup copy), lavender footer card; match logic + error/retry untouched.

**Phase 2 — chat pixel pass + save-to-Mentor-Notes loop ✅**
- **Backend:** `routers/journals.py` — `POST /journals/mentor-notes` (idempotent per Stream message id) + `GET` list; entries owner-scoped, ids in `meta` for dedupe only. **Tests: 3 new, full suite 13 passed** (needed `docker compose up -d` in `services/api` — Docker Desktop was down).
- **Web chat (mockups #7/#8):** mentor header card (PersonaAvatar + presence dot, serif name, shield line, Connected pill), dismissible privacy line, "Today" pill divider, received = white bubble + avatar + timestamp, **sent = accentTint + ink** + time + ✓✓ (read events), `ChatBubblesScene` empty state, pill composer w/ inset ＋ + circular send FAB. **Tap a mentor message → "Was this helpful?" (♥/bookmark/copy) + Save-to-Mentor-Notes card.**
- **Native:** header/privacy parity; long-press message menu gains **"Save to Mentor Notes"** (`messageActions` on stream-chat-expo v9); crisis card restyled (serif title, IconBadge helpline rows). Device verification still the tracked Maestro item.
- **Proven live (Expo web + uvicorn + real Stream):** onboard → match → user msg → **listener reply sent via the Stream server API delivered live** → save → **persisted + read back via the API**; crisis-payload message renders the helpline card (enforcement path itself untouched + previously proven). 0 console errors.

**Phase 3 — conversation controls to spec + coffee ✅**
- **Sheet** rebuilt per mockup (6 numbered bordered cards w/ tinted badges, well-being footer, **item 6 = Buy the Mento Team a Coffee**). Sub-flows = styled full overlays (`components/chat/options/`), same proven endpoints: **PIN keypad** (dots, sad-panda wrong-PIN; biometric/email-reset deferred per DoD), **Panda Mask 6 presets** (replaces free-text client-side), **Panda Pause** toggle + confirm modal, **End-vs-Wipe two-step w/ honest copy** + "All clean!", **Report/Block 7-reason radios** (reason = moderation taxonomy).
- **`/coffee`** (#28, `?energy=high` adds the #24 headline): amount chips + custom, methods **transparently disabled** ("coming very soon") until Razorpay creds land — no fake payment UI, supports the *team*, opt-in from the menu only. *(Open decision: contribution record + receipt land with the Razorpay unit — nothing to receipt while payments are off.)*
- **Proven live:** lock→wrong-PIN rejected→unlock; mask applied; pause confirmed; wipe→All clean→My Chats; Report&Block "Asking for money" → **2 moderation events verified in Postgres** (warning + suspension/blocked).
- **Inventory mis-mappings confirmed by pixel** (fix with Phase 5 docs pass): `10.31.13 AM.jpeg` = post-reflection coffee (#24), `(1)` = Panda Pause (#25), `(2)` = End/Wipe (#26), `(3)` = Report/Block (#27).

**Phase 4 — end-of-conversation reflection (#23) ✅**
- **Backend:** `conversation_reflections` (migration `5e070c058a36`) stores **only** `conversation_id` + `energy 1..5` — no user column (test-asserted), idempotent upsert, owner-checked then dropped. No points/XP anywhere. Suite **16 passed**.
- **Mobile:** `/reflection` per mockup (wave panda, 5-node slider w/ sleeping/excited panda endpoints, persona name in copy, privacy card, X = skip, Finish gated on a pick). **Plain End → reflection; energy ≥ 4 → `/coffee?energy=high` after Finish** (opt-in, post-conversation = allowed). Wipe keeps its "All clean!" path.
- **Proven live:** End → reflection → 5 → coffee (#24 headline); `energy=5` row in Postgres.
- *Dev note:* running pytest truncates the dev DB's listeners (conftest fixtures) — re-run `scripts/seed_listeners.py` after a test run, or matches 503.

**Next:** Phase 5 — new surfaces in order: My Chats (#54/55 + list-conversations endpoint), Mentors (list/profile/intro/request-sent), Journals (hub + Mentor Notes + Mood + Finance; AI assistant last, needs an LLM decision), lightweight Profile; fix MOCKUP_INVENTORY mis-mappings.

**Open decisions:** none new (tab-set + avatar-style decisions were logged in the plan).

---

## 2026-06-09 (session 8) — Design system + onboarding re-skin (in progress) 🎨

**Goal:** formalize the design system, then re-skin existing screens to the mockups and build the missing ones. Working flow-by-flow, committing + screenshotting each. Chat core untouched (no regression to crisis enforcement / blocked-listener guarantee).

**Done this session**
- **Design system (committed):** `theme/tokens.ts` (neutral light base + default accent + semantic colours, spacing, radius, typography, **elevation**); `theme/companion.ts` (growth-companion COLOUR → accent set, white-on-accent picked for **WCAG AA**); `theme/ThemeProvider`+`useTheme` (layers the per-user companion accent over the neutral base, **live switch + persistence**; `brand*` overridden so existing components theme automatically). Single source consumed by web + native. Light-mode only. `PrimaryButton` → accent + better a11y.
- **Onboarding re-skin (committed, shown):** landing, **D/M/Y age gate** (`DobPicker` via `@react-native-picker/picker` — one coherent component; accessible `<select>` on web, native wheel/dropdown; age server-side), email, companion (**live colour theming** — picking a colour re-accents the whole app + persists), connecting (re-skinned guideline card; match logic unchanged). `Screen` shell gained a back header + scroll. A11y throughout.
- **Verified on Expo web (Playwright):** landing → age (D/M/Y) → email → companion with **green theme applied live**; 0 console errors. Screenshots captured.

**Next (per the approved order, each shown + committed):**
1. Re-skin matching/chat to mockup spec (migrate chat to `useTheme` so it reflects the companion colour — carefully, no behaviour change).
2. Re-skin conversation-options sheet + PIN-lock + end-conversation reflection.
3. Build missing surfaces: **save-to-journal** long-press gesture + **Journals** (AI assistant, Finance, Mood, Mentor Notes), **My Chats** (returning-user landing, 4-tab nav), **completion/space-ready**.

**Scope guard:** UPSC self-assessment / Mirror / Knowledge Assessment suite is **deferred** (DECISIONS Option A) — not building it.

---

## 2026-06-09 (session 7) — Conversation Options sheet (end-to-end) ✅

**Goal:** wire the Conversation Options sheet to the backend — lock/mask/pause/end/wipe/report/block — each a real flow; report/block safety-checked. Done.

**Backend**
- `conversation` router: `/lock`+`/unlock` (4-digit PIN, **pbkdf2-hashed**, never stored raw), `/status-mask`, `/pause`, plus existing `/end`+`/wipe`. `/report` and `/block` both **end the chat and file a `ModerationEvent`**; block sets `blocked=True`.
- **Block prevents re-match** (Trust & Safety #9): `_pick_available_listener` excludes listeners the user has blocked. Deterministically tested.
- **Report surfaces to a human reviewer, not just stored:** `ModerationEvent` gained `reviewed`/`reviewed_by` (migration `ff69c9001c14`); new `moderation` router exposes an **admin-token-guarded** `/moderation/queue` + `/{id}/resolve`. `ADMIN_TOKEN` in settings; empty = queue disabled.
- `security.hash_pin`/`verify_pin`. Tests: **10 passed** (lock/unlock PIN, status/pause, report→queue, block→ends+blocked+no-rematch while a *different* user still matches that listener).

**Mobile**
- `components/chat/ConversationOptions.tsx` — shared custom overlay sheet (web + native), wired to new typed api methods. Report/Block/End/Wipe leave the chat (→ landing); lock/pause/status reflect server state inline. Added to **both** ChatScreen variants via the header ⋮ menu. `scrim` token added. `tsc` clean.

**Verified on Expo web (Playwright):** sheet opens; lock(PIN)/pause/status-mask/end/wipe/report/block all work; **report & block land in the review queue and the blocked listener is excluded from re-match.** 0 console errors.

**Note on running infra:** had a stale uvicorn (old code) holding :8000 — killed all `python` procs and restarted; new routes then registered. If endpoints 404 with `{"detail":"Not Found"}`, suspect a stale server.

**Next:** journals + AI assistant; contribution surface; mentor discovery list; native device verification (Maestro) for the stream-chat-expo UI + the options sheet.

---

## 2026-06-09 (session 6) — real-time Stream chat + server-side crisis enforcement ✅

**Goal:** wire real-time Stream chat; make the crisis scan un-bypassable on the real message flow; keep Panda Wipe a real server delete; smoke-test on Expo web. Done.

**Decision taken (founder):** crisis scan enforced via Stream **before-message-send webhook** (synchronous), with the explicit fail-mode below.

**Backend — proven against LIVE Stream (cloudflared tunnel)**
- `routers/stream_hooks.py`: `POST /stream/before-message-send` (sync enforcement) verifies `X-Signature` (**gzip-aware** — Stream signs the *decompressed* body), scans, writes a `SafetyFlag` (signal only), and augments the message with a `crisis` payload (support copy + helplines). `POST /stream/webhook` (async `message.new`) re-scans as the retried safety net. Dedupe via new `SafetyFlag.stream_message_id` (migration `ac14868c5699`).
- `services/safety.py` shares one `scan_and_flag` path across both hooks + `/safety/scan`. `services/stream.py`: `verify_webhook`, `configure_webhooks` (sets `before_message_send_hook_url` + v2 `event_hooks` for `message.new`; +5000ms hook timeout). `scripts/configure_stream.py` points Stream at a base URL. `seed_listeners` now upserts listeners as Stream users.
- **CRISIS PROOF (the critical one):** a crisis message sent **straight through the Stream API, bypassing the mobile UI**, still produced a `SafetyFlag` (suicidal) + the injected `crisis` field; benign did not. → enforcement is on the path, not in the client.
- **Wipe PROOF:** message present on Stream before `/conversations/{id}/wipe`, gone after (`hard_delete`).
- Tests: `tests/test_stream_webhook.py` (signature gate, flag+augment, benign pass-through, no double-flag). Matcher test stubs Stream to stay hermetic with creds present. **Full suite 6 passed.**
- **Fail-mode (documented in CLAUDE.md §1):** before-send is **fail-open** (never hard-block a support chat); the retried `message.new` webhook re-scans anything missed during an outage → fail-open but **never silent**.

**Mobile — real-time chat (native + web), proven on Expo web**
- Platform-split chat: `components/chat/ChatScreen.tsx` (native, **stream-chat-expo** UI kit) + `ChatScreen.web.tsx` (web, **stream-chat JS client** + custom UI). `app/chat/[id].tsx` re-exports it. Split lives in a directly-imported component so expo-router's `require.context` never pulls the native build into the web bundle. `AppProviders` (native = GestureHandler+OverlayProvider, web = passthrough).
- Crisis card renders from the **server-injected** `crisis` field (own message via send response, received via `message.new`) — client never scans.
- **Web Playwright two-party smoke → PASS:** chat renders; listener→user message **delivers live**; a crisis message typed in the live UI renders the helpline card (Tele-MANAS 14416 + KIRAN). `tsc --noEmit` clean.

**⚠️ What broke / carry forward**
- **stream-chat-expo does NOT bundle on Expo web** (its RN new-arch internals fail under react-native-web). Resolved by the platform-split (web uses the JS client). **The native UI kit still needs on-device verification (Maestro/iOS/Android).**
- **Stream secret was pasted in chat → ROTATE it** in the Stream dashboard. Creds live in gitignored `services/api/.env` + `apps/mobile/.env` (publishable key only).
- **Webhook URL is an ephemeral cloudflared quick-tunnel** — re-run `cloudflared tunnel --url http://localhost:8000` then `python -m scripts.configure_stream <url>` each session; use a stable URL for staging.
- Conversation-options UI (lock/pause/end/wipe/report) still not built; wipe exists as a backend endpoint only.

**How to resume / re-run the live Stream flow**
1. `cd services/api`; `docker compose up -d`; `.\.venv\Scripts\python.exe -m alembic upgrade head`; seed; run uvicorn on :8000.
2. Tunnel: `cloudflared tunnel --url http://localhost:8000` → copy the trycloudflare URL.
3. `.\.venv\Scripts\python.exe -m scripts.configure_stream https://<tunnel>`.
4. Mobile web: `cd apps/mobile`; `npx expo start --web --port 8081 -c`.

---

## 2026-06-08 (session 5) — dev on Postgres by default + API CI ✅

**Goal:** make dev and tests share one engine (Postgres), and add CI that proves it on every push. Done.

**Dev → Postgres by default**
- Confirmed the committed default was *already* Postgres (`config.py` default + `.env.example`); the session-3 SQLite usage was a shell override, not a default. Clarified the `.env.example` comment (localhost = docker-compose Postgres; managed Postgres in staging/prod). No `.env` file exists, so a fresh `uvicorn` already uses Postgres.
- **Verified the slice on Postgres** (no `DATABASE_URL` override, default resolved): health ok → onboarding (persona "Deep Meadow" + token) → **age-gate blocks a minor (403)** → match (listener "Free Lake" + Stream stub channel) → **crisis scan → suicidal + Tele-MANAS 14416 + KIRAN 1800-599-0019 + support copy.**

**CI** — `.github/workflows/api-ci.yml` (triggers on pushes/PRs touching `services/api/**`):
`docker compose up -d --wait` (same compose as dev; waits on healthchecks) → `pip install -r requirements-dev.txt` → `alembic upgrade head` → `alembic check` (fails if a model change lacks a migration) → `pytest` → `compose down -v`.
- **Simulated the exact sequence locally from a clean volume → green:** both containers healthy, migration applied, `alembic check` clean, **`2 passed`** (concurrency tests included).

**Next**
1. Real-time chat via `stream-chat-expo` (needs Stream creds in `.env`).
2. Wire conversation-options flows to the backend.

---

## 2026-06-08 (session 4) — Postgres + Alembic + matcher concurrency proven ✅

**Goal:** stand up real Postgres for dev, write the first migrations, and *prove* the matcher can't double-assign under concurrency. Done.

**Postgres for dev**
- Added `services/api/docker-compose.yml` (Postgres 16 + Redis 7; Postgres = `mento/mento/mento` on :5432, matching the default `DATABASE_URL`). `docker compose up -d` → healthy.

**Alembic (first migrations)**
- Scaffolded `alembic.ini` + `migrations/env.py` (pulls URL from app settings, `target_metadata = Base.metadata`, `compare_type=True`) + `script.py.mako`.
- Autogenerated **initial migration** `b34a2dc93a28` (all 8 tables + enums + indexes). `alembic upgrade head` applied; **`alembic check` → "No new upgrade operations detected"** (schema == models).

**Matcher concurrency — PROVEN (the session-3 open item)**
- `tests/test_matching_concurrency.py` (pytest, **Postgres-required**, auto-skips on SQLite):
  1. **Mechanism:** one txn holds the only eligible listener row `FOR UPDATE`; the matcher must *skip* it (SKIP LOCKED) and raise `NoListenerAvailable` — `SET lock_timeout=3s` so a regression fails fast instead of hanging.
  2. **Outcome:** 32 threads hit a capacity-1 listener via a `threading.Barrier` (each reserves a connection pre-barrier). Asserts **exactly 1 winner, 31 × `NoListenerAvailable`, `active_conversations==1`, 1 conversation row.**
- **`2 passed in 2.19s`.**
- **Teeth verified:** a throwaway monkeypatch dropping `with_for_update(skip_locked=True)` → naive read → **32/32 winners, 32 conversations every run** (gross double-assignment). So the test genuinely catches the regression. (Throwaway not committed; production `matching.py` unchanged.)
- Added `requirements-dev.txt` (pytest) + `pytest.ini`.

**Resolves** the session-3 ⚠️ "SQLite ≠ prod / concurrency unproven / no Alembic" item. Web/native device verification (Maestro) and Stream-real-time-on-creds still open.

**Next**
1. Real-time chat via `stream-chat-expo` (needs Stream creds in `.env`).
2. Wire conversation-options flows to the backend.
3. Point the app's dev DB at Postgres too (currently the running app can still use SQLite); consider a CI job that runs `docker compose up` + `alembic upgrade head` + `pytest`.

**How to resume / re-run**
- `cd services/api`; `docker compose up -d`; `./.venv/Scripts/python.exe -m alembic upgrade head`; `./.venv/Scripts/python.exe -m pytest`. (DB URL defaults to the compose Postgres; override with `DATABASE_URL`.)

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
