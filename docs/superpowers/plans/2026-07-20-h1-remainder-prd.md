# PRD — H1 Remainder: PostHog funnel · Sentry + DigitalOcean deploy artifacts · Hindi core loop + tabs

> **Executor contract:** this file is the plan. Work top-to-bottom, one task at a time, commit per task group as marked.
> Source-of-truth order still applies: `docs/DECISIONS.md` → `docs/PRD.md` → mockups. `CLAUDE.md` rules are binding.
> Start the session by invoking the **mento-stack** skill. Before claiming ANY task done, invoke **mento-verify**. End with **mento-session-end**.
> If a task is blocked or reality contradicts this file: do the closest correct thing, log it under `PROGRESS.md → Open decisions`, and keep going. Never silently skip; never block waiting for an answer.

---

## OBJECTIVE

Ship the three agreed H1-remainder capabilities, all **env-gated so they run dark without credentials** (founder ruling 2026-07-20 — the executor never blocks on keys):

1. **PostHog onboarding→chat funnel** — client-side, anonymous, allowlisted events only. Answers "where do people drop off between opening the app and talking to a human." No-ops completely when `EXPO_PUBLIC_POSTHOG_KEY` is empty.
2. **Sentry error reporting (API + mobile) and DigitalOcean deploy artifacts** — Sentry inits only when a DSN is set; Dockerfile + DO App Platform spec + runbook exist and the image is proven to build and boot locally. No infra is provisioned in this pass.
3. **Hindi across the core loop + tabs** — landing → onboarding → connecting → chat chrome, plus the Chats/Path/Journals/Profile tab surfaces and reflection. i18n plumbing (`i18n-js` + `expo-localization`), language persisted, Devanagari-capable font, EN stays pixel-identical by default.

Why now: these are the last H1 items before deploy/Hindi launch (PROGRESS sessions 17–18, "Next" horizon). None require a DB migration — the whole PRD is migration-free by design.

**Explicitly OUT of this PRD:** provisioning real DO infra; server-side PostHog capture; translating the server-driven Path content (`services/api/app/services/paths_data.py` community names/stages/prompts stay English — logged as an open decision); the coffee screen translation; EAS/native release builds; any matcher, crisis-scan, or migration change.

---

## SUCCESS — verify every box before calling the PRD done

- [ ] `cd apps/mobile && npx tsc --noEmit` → exit 0.
- [ ] `cd services/api && .\.venv\Scripts\python.exe -m pytest` → all pass (≥ 54; count may grow, never shrink). Then `alembic check` → "No new upgrade operations detected". Then re-seed listeners.
- [ ] `git -C . diff --stat` shows **zero** files under `services/api/migrations/` — this PRD adds no migrations.
- [ ] `docker build -t mento-api services/api` succeeds; the container boots with `ENV=dev` against the compose Postgres/Redis and `GET http://localhost:8080/api/v1/health` returns ok (Task B5 has the exact command).
- [ ] Existing e2e suites green, 0 page errors: `path-communities.e2e.js` and `connecting-experience.e2e.js` (env reset before EACH — see mento-e2e).
- [ ] New `apps/mobile/e2e/analytics-dark.e2e.js` green: full journey with no PostHog key produces **zero network requests** to the PostHog host.
- [ ] New `apps/mobile/e2e/hindi-core-loop.e2e.js` green: with locale seeded to `hi`, landing → onboarding → connecting → chat completes with Hindi strings asserted at each stage, 0 page errors, plus a `reducedMotion: 'reduce'` pass that also completes.
- [ ] With locale `en` (default), the app is string-identical to before this PRD — the existing e2e text assertions passing is the proof.
- [ ] `lib/analytics.ts` event names and prop keys are a closed TypeScript union; no prop carries email, DOB, message content, persona name, user id, or conversation id. No crisis-related event exists.
- [ ] Sentry: API boots with `SENTRY_DSN` unset (pytest already proves boot); `send_default_pii=False` and request bodies stripped in `before_send`. Mobile inits only when `EXPO_PUBLIC_SENTRY_DSN` is non-empty.
- [ ] No raw hex colors or raw durations introduced (spot-check your own diff; tokens only).
- [ ] `.env.example` files (both) list every new var with a comment.
- [ ] `CLAUDE.md` stack table + env-vars line updated (PostHog wired, Sentry row, i18n note, new layout entries); `PROGRESS.md` session entry written; all work in conventional commits; `git status` clean.

---

## MILESTONES

| # | Milestone | Commits | Ships |
|---|---|---|---|
| A | Analytics funnel (dark) | 1 | `lib/analytics.ts` + capture calls + `analytics-dark.e2e.js` |
| B | Sentry + deploy artifacts | 2 (api / mobile+docs) | Sentry init both sides, Dockerfile, `deploy/do-app.yaml`, `docs/DEPLOY.md` |
| C | Hindi core loop + tabs | 3–4 (plumbing / core loop / tabs / e2e) | i18n system, hi strings, font, toggle, `hindi-core-loop.e2e.js` |
| D | Reconcile + log | 1 | CLAUDE.md updates, PROGRESS entry |

Work strictly A → B → C → D. A and B are independent of C, so a failure in one doesn't poison the others; C is the largest and benefits from a warm, proven stack.

---

## TASKS

### Milestone A — PostHog funnel (one commit: `feat(mobile): anonymous onboarding funnel, env-gated`)

**A1. Create the analytics module.**
- Files: `apps/mobile/lib/analytics.ts` (new).
- Build a dependency-free wrapper around PostHog's HTTP capture endpoint (`POST {EXPO_PUBLIC_POSTHOG_HOST}/capture/` with body `{ api_key, event, distinct_id, properties }`). **Do not install any PostHog SDK** — deliberate choice: zero native deps, fully inert when dark.
- `distinct_id`: a random UUID generated once and persisted under key `mento.analytics_id` using the same platform-split storage pattern as `apps/mobile/lib/session.ts` (localStorage on web, SecureStore native). It must NOT be the server user id or persona.
- Event names and allowed props are a **closed union type**:
  - `landing_viewed` · `onboarding_started` · `onboarding_age_passed` · `onboarding_email_step {skipped: boolean}` · `onboarding_companion_chosen {companion: string}` · `onboarding_completed` · `path_chosen {community: string}` · `match_requested {mode: 'general' | 'personal'}` · `match_found {wait_bucket: '<5s' | '5-15s' | '15-60s' | '>60s'}` · `chat_first_message_sent` · `reflection_submitted` (no energy value — reflection is private).
- Rules enforced in code: if `EXPO_PUBLIC_POSTHOG_KEY` is empty → return synchronously before any network/storage work; capture is fire-and-forget `fetch(...).catch(() => {})` — it may never throw or block UI; no other props accepted (the union is the enforcement).
- Done when: file exists, `npx tsc --noEmit` clean, and passing a disallowed event name or prop is a compile error (try it, then revert the try).

**A2. Instrument the journey.**
- Files: `apps/mobile/app/index.tsx` (landing_viewed on mount, onboarding_started on CTA), `apps/mobile/components/onboarding/OnboardingJourney.tsx` + `components/onboarding/steps/*` (age passed, email step with `skipped`, companion chosen, completed), the connecting step in `components/onboarding/steps/` (match_requested / match_found — bucket the measured wait, never send raw ms), `components/chat/ChatScreen.tsx` + `.web.tsx` (chat_first_message_sent — fire once per screen mount, guard with a ref), `apps/mobile/app/reflection.tsx` (reflection_submitted), the Pathfinder component under `components/` for `path_chosen`.
- Read each file before editing; call `capture()` at the existing success points — do not restructure any flow to instrument it.
- Done when: tsc clean; both existing e2e suites still green (env reset before each).

**A3. Prove darkness.**
- Files: `apps/mobile/e2e/analytics-dark.e2e.js` (new).
- Copy the structure of `e2e/connecting-experience.e2e.js` (plain Node script, headless, 390×844, 0-page-error assertion, NODE_PATH runner — see `e2e/README.md`). Add `page.on('request')` capturing any URL containing `posthog`; walk landing → onboarding → chat; assert the captured list is empty (the dev `.env` has no key).
- Done when: script passes; commit Milestone A.

### Milestone B — Sentry + DigitalOcean deploy artifacts

**B1. API Sentry, env-gated.** (commit 1 of 2: `feat(api): sentry, env-gated`)
- Files: `services/api/requirements.txt` (add `sentry-sdk[fastapi]`, pin the current version), `services/api/app/config.py` (add `sentry_dsn: str = ""`), `services/api/app/main.py` (init before app construction: only when `settings.sentry_dsn` is non-empty; `send_default_pii=False`; `traces_sample_rate=0.0` — errors only; `before_send` hook that deletes request body/data from the event — message content must never reach Sentry), `services/api/.env.example` (add `SENTRY_DSN=` with comment "empty = Sentry off").
- `pip install -r requirements.txt` into the venv after editing.
- Done when: pytest fully green (proves boot with DSN unset), `alembic check` clean, listeners re-seeded.

**B2. Mobile Sentry, env-gated.** (goes in commit 2 with B3–B5: `feat(mobile)+docs: sentry init + DO deploy artifacts`)
- Files: `apps/mobile/package.json` (via `npx expo install @sentry/react-native`), `apps/mobile/app.json` (add the `@sentry/react-native/expo` plugin entry), `apps/mobile/components/AppProviders.tsx` and `AppProviders.web.tsx` (init at module top: only when `process.env.EXPO_PUBLIC_SENTRY_DSN` is non-empty), `apps/mobile/.env.example` (add `EXPO_PUBLIC_SENTRY_DSN=`).
- JS-error capture only this pass — native crash symbolication and the metro/source-map wiring are release-build work; note that limitation in `docs/DEPLOY.md` (B4).
- After the dependency change restart Expo with `-c`.
- Done when: tsc clean; web still loads with no DSN set; both existing e2e suites green.

**B3. Dockerfile + dockerignore.**
- Files: `services/api/Dockerfile` (new), `services/api/.dockerignore` (new).
- `FROM python:3.12-slim`; install `requirements.txt`; copy `app/`, `migrations/`, `alembic.ini`, `scripts/`; non-root user; `EXPOSE 8080`; `CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 2"]`. `.dockerignore`: `.venv`, `__pycache__`, `.env`, `tests/`, `.pytest_cache`.
- Done when: `docker build -t mento-api services/api` exits 0.

**B4. DO App Platform spec + runbook.**
- Files: `deploy/do-app.yaml` (new, repo root `deploy/`), `docs/DEPLOY.md` (new).
- `do-app.yaml`: one service built from `services/api/Dockerfile`; health check path `/api/v1/health`; a pre-deploy job running `python -m alembic upgrade head`; env slots (values as `${...}` secrets, never real values): `ENV=production`, `JWT_SECRET`, `DATABASE_URL`, `REDIS_URL`, `STREAM_API_KEY`, `STREAM_API_SECRET`, `ADMIN_TOKEN`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `POSTHOG_API_KEY`, `SENTRY_DSN`.
- `DEPLOY.md` covers, in order: create DO managed Postgres 16 + Redis; set secrets; first deploy; run `scripts.configure_stream` to point the Stream webhooks at the public URL (see the **mento-crisis-webhook** skill for the proof ritual); the startup invariants (the API **refuses to boot** in production with a default `JWT_SECRET` or missing Stream creds — that is the guard working, not a bug); Stream secret rotation note; Sentry mobile limitation from B2; how to verify post-deploy (health, seeded listener match, webhook flag test).
- Done when: both files exist and every env var in `do-app.yaml` also appears in `services/api/.env.example`.

**B5. Prove the image boots.**
- No repo files; verification only.
- With the compose stack up: `docker run --rm -d -p 8080:8080 -e ENV=dev -e DATABASE_URL=postgresql+asyncpg://mento:mento@host.docker.internal:5432/mento -e REDIS_URL=redis://host.docker.internal:6379/0 --name mento-api-smoke mento-api` (read the real user/password/db from `services/api/docker-compose.yml` first and adjust; keep the driver prefix identical to the one in `.env`). Then `curl http://localhost:8080/api/v1/health` → ok → `docker stop mento-api-smoke`.
- If the container can't reach the host DB, that is an environment quirk, not app failure — document what happened in PROGRESS and rely on the compose-uvicorn health check; do not refactor the app to fix Docker networking.
- Done when: health ok (or the fallback documented); commit Milestone B (commit 2).

### Milestone C — Hindi core loop + tabs

**C1. Plumbing.** (commit: `feat(mobile): i18n plumbing — locale provider, persisted, device-default`)
- Files: `apps/mobile/package.json` (`npx expo install expo-localization` then `npm install i18n-js`), `apps/mobile/locales/en.json` (new), `apps/mobile/locales/hi.json` (new), `apps/mobile/lib/i18n.tsx` (new), `apps/mobile/components/AppProviders.tsx` + `.web.tsx` (mount the provider), `apps/mobile/tsconfig.json` (ensure `resolveJsonModule: true` — check before assuming).
- `lib/i18n.tsx`: an `I18n` instance from `i18n-js` with both locale files; a `LanguageProvider` + `useI18n()` hook exposing `t(key)`, `locale`, `setLocale`; keys typed as `keyof typeof en` (import the JSON) so a missing key is a compile error. Default locale: persisted value under `mento.lang` (same storage pattern as `lib/session.ts`) → else `hi` if `expo-localization` `getLocales()[0].languageCode === 'hi'` → else `en`. Locale changes re-render live (context state), no reload.
- On web, also honor a `?lang=hi` query param or a pre-seeded `localStorage['mento.lang']` at startup — this is the e2e hook (C6).
- Restart Expo with `-c` after the installs.
- Done when: tsc clean, app renders unchanged in English, both existing e2e suites green.

**C2. Devanagari font.** (same commit as C1 or its own — executor's call)
- Files: `apps/mobile/assets/fonts/` (add Noto Sans Devanagari Regular + Bold from Google Fonts — OFL license; note the license in a one-line README next to the files), the font-loading site (find it: `Grep` for `useFonts` or `Font.loadAsync` under `apps/mobile/` — likely the root layout or AppProviders), `apps/mobile/theme/tokens.ts` or `ThemeProvider` (expose the font family the same way Nunito/Lora are exposed today — read first, mirror the existing mechanism).
- Rule: when locale is `hi`, text styles resolve to Noto Sans Devanagari; when `en`, byte-identical to today. If fonts are consumed via tokens (expected), swap at the provider level — do NOT touch every component. Lora (serif display) has no Devanagari face; map hi display text to Noto Sans Devanagari Bold and log the aesthetic call in Open decisions.
- Done when: tsc clean; with locale forced to `hi`, landing shows Devanagari glyphs in Noto (screenshot at 390×844 to the scratchpad), and with `en` the existing e2e suites still pass.

**C3. Extract + translate the core loop.** (commit: `feat(mobile): hindi core loop`)
- Files: `apps/mobile/app/index.tsx` (landing), `components/onboarding/OnboardingJourney.tsx`, `components/onboarding/StepScaffold.tsx`, every file in `components/onboarding/steps/`, `components/chat/ChatScreen.tsx` + `.web.tsx` (chrome only: placeholder, header states, banners — never message bodies), `components/chat/CrisisCard.tsx`, `components/chat/ConversationOptions.tsx` + `options/*`, `app/reflection.tsx`, plus `locales/en.json` / `locales/hi.json`.
- Method per file: move each user-visible literal into `en.json` under a namespaced key (`landing.title`, `onboarding.age.error`, `chat.crisis.helpline`, …), replace with `t()`, add the Hindi rendering to `hi.json`. Register: warm, respectful, simple Hindi (आप, not तू); Calm tone, no slang. Helpline names/numbers (Tele-MANAS 14416, KIRAN 1800-599-0019) stay identical in both locales.
- The crisis-card and safety copy translations are **safety-critical**: translate carefully and add "Hindi crisis copy needs native-speaker review before launch" to Open decisions (launch gate, same tier as the privacy policy).
- Done when: tsc clean; existing e2e suites (which assert English strings) still green — proof EN is untouched.

**C4. Extract + translate the tab surfaces.** (commit: `feat(mobile): hindi tabs`)
- Files: the four tab screens under `apps/mobile/app/(tabs)/` (chats, path, journals, profile) and the components they render for chrome/empty states (find with Grep; journals hub + the four journal channel screens under `app/journal/`), plus the locale JSONs.
- Path tab: translate only client chrome (buttons, headings, Pathfinder question framing). The community names, stages, prompts, and seasonal cards arrive from the server and **stay English** — do not add a locale param to the API; log "server-driven Path content localization" as an open decision.
- Done when: tsc clean; `path-communities.e2e.js` green (it asserts EN defaults).

**C5. Language toggle.** (same commit as C4)
- Files: the Profile tab screen in `app/(tabs)/`.
- A two-option selector (English / हिंदी) in the Profile settings list, styled with existing tokens/components (read how the neighboring rows are built and match them). Calls `setLocale`; persists via the provider; the app re-renders live.
- Done when: toggling in the browser flips landing/tabs copy live both directions, no reload, no console errors.

**C6. Hindi e2e.** (commit: `test(mobile): hindi core-loop e2e`)
- Files: `apps/mobile/e2e/hindi-core-loop.e2e.js` (new).
- Same conventions as the existing suites. Use `context.addInitScript` to seed `localStorage['mento.lang'] = 'hi'` before load (the C1 hook). Walk landing → onboarding (age → skip email → companion) → connecting → chat; assert one known Hindi string per stage; assert 0 page errors; second pass under `reducedMotion: 'reduce'` must also complete. Reset env before the run (mento-e2e).
- Done when: green twice in a row.

### Milestone D — Reconcile + log (commit: `docs: h1-remainder reconcile + progress`)

**D1. CLAUDE.md updates.**
- Stack table: PostHog row → "wired: anonymous client funnel via `lib/analytics.ts` (HTTP capture, no SDK), dark until key set"; add Sentry row (env-gated both sides, errors-only); Lottie row untouched. Env-vars line: add `SENTRY_DSN` (API) and `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`/`_HOST` (mobile). Repo layout: add `locales/`, `deploy/`, `services/api/Dockerfile`, `docs/DEPLOY.md`, the two new e2e scripts. Add a coding-conventions bullet: "User-visible strings via `useI18n().t()` — never hardcoded literals in components; analytics via `lib/analytics.ts` only, allowlisted events, no PII ever."
- Done when: every claim in the edited sections is true of the repo you just built.

**D2. PROGRESS.md session entry + commit.**
- Follow the **mento-session-end** skill exactly. Open decisions to carry: server-driven Path content localization; Hindi crisis-copy native review (launch gate); Lora-has-no-Devanagari display-font call; DO provisioning + real creds (PostHog key, Sentry DSN) when founder is ready; plus everything already carried from session 18.
- Done when: `git status` clean, entry on top of PROGRESS.md.

---

## HANDOFF

**Session ritual.** Start: invoke **mento-stack** (expect possible stale :8000/:8081 processes — the repair table covers it). Before any "done": **mento-verify** (pytest → `alembic check` → **re-seed listeners** → tsc). E2E: **mento-e2e** — reset Redis + `active_conversations` before EVERY suite, not once per session; run with the NODE_PATH form from the skill. End: **mento-session-end**.

**Work order.** A → B → C → D, tasks in numeric order, commit at each marked point, verify before each commit. Never batch milestones into one commit. If a task fails verification, fix it before moving on — do not carry red state forward.

**Conventions that will bite if ignored.**
- `strict` TypeScript; no `any` without `// reason:`. Design tokens only — no raw hex, no raw durations (`theme/motion.ts`). Typed API clients only (`lib/api.ts`) — no hand-written fetch in components (the `lib/analytics.ts` fetch is sanctioned because it lives in `lib/`, is fire-and-forget, and talks to a third party, not our API).
- Web/native splits use `.web.tsx`; when you touch `AppProviders` or `ChatScreen`, touch **both** variants.
- Motion rules are non-negotiable (transform/opacity only, reduced-motion honored) — this PRD adds no animation; don't add any incidentally.
- Read every file before editing it. Mirror the neighboring code's style; this repo has no linter, discipline is manual.

**Gotchas (all previously paid for).**
- pytest truncates the dev listeners table → matching 503s that look like a matcher bug. Re-seed; don't debug.
- E2E runs exhaust the onboarding rate limit (429 = `FLUSHDB`) and listener capacity (503 = reset `active_conversations`). Reset before each suite.
- New endpoint 404s / weird API behavior after backend edits → stale uvicorn; kill :8000 and restart (mento-stack snippet).
- After any `package.json` change: `npx expo start --web --port 8081 -c` (Metro cache serves stale modules otherwise), and expect the non-interactive port prompt if a stale Expo holds :8081 — kill it first.
- `EXPO_PUBLIC_*` vars are inlined at bundle time — changing `.env` requires an Expo restart; you cannot flip them mid-e2e.
- Playwright is NOT a project dependency; e2e scripts are plain Node run with the external NODE_PATH (see `e2e/README.md`).
- The API's refusal to boot outside dev with default `JWT_SECRET`/missing Stream creds is a deliberate invariant — never "fix" it.

**Hard rails (do not cross, even if it seems helpful).**
- No DB migrations, no matcher changes, no crisis-scan changes, no new npm/pip dependencies beyond the ones this file names.
- Analytics: never send message content, email, DOB, persona names, user/conversation ids, or anything crisis-related. The closed union in `lib/analytics.ts` is the enforcement — widening it is a product decision, not an implementation detail.
- Sentry: `send_default_pii=False` and body-stripping are T&S requirements, not defaults to tune.
- English output must be byte-identical after Milestone C — the existing e2e suites are the regression net; if one goes red on a string, you broke extraction, not the test.
- Founder calls you can't make: log to `PROGRESS.md → Open decisions` and continue with the Calm-register default. Never wait; never decide silently.
