# PROGRESS.md — Mento

> Restart-from-anywhere log. Newest entry on top. Each entry: Done / In-progress / Next / Open decisions / How to resume.

---

## 2026-09-05 (session 31b) — Fidelity foundation: Clay and Sage tokens, Baloo 2, PressKey ✅ (branch `feat/fidelity-foundation`)

**Context:** founder ruling `DECISIONS.md` §K.8 (fidelity pass, browser mockups): pillow-key depth language (visible bottom edge, collapses on press, medium impact haptic — rejected soft clay/quiet matte), painterly companion art direction (later, Plan 2), Focus-physics chat (rising bubbles, breathing typing dots, pressing send key — no ambient scene, no companion in-chat), build order foundation-first (tokens/type/PressKey/chat physics) then the companion asset pipeline. This branch is the foundation half, on top of `5cce83b`; spec `docs/superpowers/specs/2026-09-05-fidelity-pass-design.md`.

**Done (20 commits, `git log --oneline master..feat/fidelity-foundation`, mobile-only):**
- `518d4ca` Baloo 2 as the single type family (Latin + Devanagari); Nunito/Lora/Noto removed; `type.displayHeadline`.
- `c877386` Clay and Sage palette + terracotta-default companion accents + `scripts/contrast_gate.py`; follow-ups `d636bac` (Devanagari headroom, Logo/Scenes read tokens not purple literals), `52320d2` (`inkMuted` cleared to AA on ritual screens, gate covers `bgLavender`, ink shadows, IconBadge glyphs from tokens).
- `e18d5c2` `PressKey` + `EdgeSurface` depth primitives; fix `f12b90b` (disabled dims, edge shares face corners, sizing moved to `containerStyle`).
- `7d1100a` PrimaryButton / TiltCard / Card on the key; fix `634d2d5` (ghost keys never vanish on white — moved to `surfaceAlt`; TiltCard takes a radius for its edge).
- `ebfcdb8` tab pill, conversation/journal/mentor/profile rows, New Chat sheet on the key; fix `877dbf0` (no doubled spacing on Chats rows/sheet rows/companion card, drop dead imports).
- `da435ad` chips, payment rows, Path talk card on the key; fix `443a319` (margins on containers not faces, income chip edge, dead radius).
- `589b861` Focus chat physics — rise-in messages, breathing `TypingDots`, pillow send key, receive haptic; fix `a7362c9` (rise-in plays once per message — prune `freshIds` after the first animation).
- `d8e896a` + `f6b0d13` Lottie re-bake onto Clay and Sage (dedupe `(Mento themed)` suffix from the re-bake).
- `9b73bec` onboarding + Mentor Home headlines on `type.displayHeadline`; `4c6893f` scene art waves/mountains + ConnectingStep headline read tokens.
- `2ec5355` persona avatar landscapes on the clay family; 🧡 replaces 💜 in copy.
- **Proven:** `npx tsc --noEmit` clean at every commit; contrast gate 51/51 (`python scripts/contrast_gate.py`); all nine e2e suites PASS with 0 page errors, normal + reduced motion — `connecting-experience`, `path-communities`, `hindi-core-loop`, `member-screens`, `listener-apply`, `apply`, `analytics-dark`, `journal-organize`, `role-fork`; a 42-screen screenshot walk at 390×844 reviewed against the concept gallery.

**Spec deviations (decided in review, founder veto welcome):**
- Accent values deepened from the concept renders so white labels and accent text pass WCAG AA on white, oat, **and** the ritual oat (`bgLavender`) — the light concept terracotta survives as `accentSoft`/tints.
- Ghost buttons sit on `surfaceAlt`, not white.
- The Logo stays a fixed brand mark (static tokens, not the per-user companion accent).
- `wash.*` token names kept (values now Clay and Sage) — rename optional, not done.
- Persona-avatar palettes are a categorical set, not the companion accent.

**Open (founder):**
- **Native chat physics not applied** (spec §3 named both chat screens): `components/chat/ChatScreen.tsx` still renders stream-chat-expo's `MessageList`/`MessageComposer`, which expose no per-row animation hook — native gets the palette only (token-driven Stream theme). Rise-in, TypingDots and the pillow send key are web-only until the native chat is rebuilt (natural home: the native mentor console / custom message list work).
- **Pillow key not yet on every screen**: `app/mentor/[id].tsx`, `app/apply.tsx`, `app/journal/organize.tsx`, `components/ApplicationForm.tsx` (pledge card) and the status cards in `app/mentor-home.tsx` still use `elevation.sm` cards — outside Plan 1's file list; mechanical follow-up with `EdgeSurface`/`PressKey`.
- `TypingDots` accessibility label is a literal string, not an i18n key.
- `chat.typing` locale key is now unused — the listener console hardcodes its own typing string (pre-existing i18n gap, not introduced this session).
- `font.serif*` / `devanagari*` token names alias Baloo 2 now and should be renamed to match.
- Raster art still on the old palette: `assets/scenes/*.webp` scene tiles, journal empty-state art, companion webp poses (purple scarf) — companion art is Plan 2 (the asset pipeline), scene rasters are a later art pass.
- `mentors.tsx` has hardcoded English strings (pre-existing, not introduced this session).
- If the pillow edge on message bubbles reads heavy on-device, dropping it is a one-token change.

**Next:** merge `feat/fidelity-foundation` into master (finishing-a-development-branch), then Plan 2 — the companion asset pipeline (one reference + six poses per animal, all six animals, ~52 credits approved) — then the native mentor console spec (DECISIONS §K.7).

**How to resume:** branch `feat/fidelity-foundation` is complete; `git log --oneline master..feat/fidelity-foundation` lists the 20 commits above. Expo needs a `-c` restart after switching branches (font package changed). `python scripts/contrast_gate.py` is the palette gate — run after any token edit. The 42-screen screenshot-walk script used for review lives in the session scratchpad only (not committed).

---

## 2026-09-05 (session 31) — Role fork after landing + Mentor Home ✅ (branch `feat/role-fork`)

**Context:** founder's new requirement (session 30): a screen after the landing that asks whether the person is here to talk or to listen, and takes each to their path. Brainstormed with browser mockups (two-doors layout chosen), spec `docs/superpowers/specs/2026-09-04-role-fork-design.md`, plan `docs/superpowers/plans/2026-09-04-role-fork.md`, ruling `DECISIONS.md` §K.7. Executed subagent-driven (Sonnet implementers + two-stage Sonnet reviews per task) on `feat/role-fork`, not yet merged to master.

**Done (13 commits, zero backend changes):**
- `fbed255` role preference (`lib/session.ts` `saveRole`/`getRole`, key `mento.role`, cleared by Start fresh; draft `role`; analytics `role_chosen`).
- `6dca478` + `f9e9235` EN/HI strings for role / primer / handoff / Mentor Home (review fix: gender-neutral Hindi for "I'd rather talk today").
- `7da4f79` `RoleStep` (two doors, `role-talk` / `role-listen`); `8ec002c` + `3245382` `PrimerStep` + `HandoffStep` (session minted once, no match, unmount-guarded).
- `81b7604` + `a4a3777` journey wiring: role = step zero, `MENTEE_ORDER` byte-identical to the old order, `MENTOR_ORDER` = role → age → email → primer → handoff; deep links past `age` need a DOB **and** must belong to the draft role's order; review fixes: one haptic per role tap.
- `62110bc` + `1956264` `app/mentor-home.tsx` (outside the tab shell; companion hero; inline `ApplicationForm` / pending / approved + console link / declined; "I'd rather talk today" assigns the default companion if none, sets role mentee, lands on Chats). Review fixes: switch wrapped in try/catch, identity reads best-effort, application fetch alone drives the error card.
- `21a7268` landing redirect honours the role (`/` → `/mentor-home` for a stored mentor session).
- `47c8920` all onboarding-driven e2e suites gain one tap (`role-talk`); `e5de82b` new `e2e/role-fork.e2e.js`.
- **Proven:** `tsc` clean at every commit; `connecting-experience`, `path-communities`, `hindi-core-loop`, `member-screens`, `listener-apply`, `analytics-dark`, `journal-organize` PASS (0 page errors, normal + reduced-motion); `role-fork` PASS (listen door → primer → handoff → Mentor Home → submit → pending → switch to talk → Chats; returning mentor lands on Mentor Home from `/`; normal + reduced-motion). `two-party-chat` patched, not run (manual listener setup).

**Spec deviations (decided in review, founder veto welcome):**
- Role tap fires **one** haptic (the journey's `advance`), not select-then-advance — two in one gesture reads as a stutter.
- **No client-side 30-day reapply gate on Mentor Home.** The server anchors the cooldown on decline time (`updated_at`), which the API doesn't return, and this feature is zero-backend-change — a declined mentor sees the declined card + the form, and the server's 409 (shown by the form's own error display) is the single source of truth, same as Profile → apply today.

**Open (founder):**
- Mentors get the default panda silently (no companion step on the mentor branch); alternative is two extra screens before the form.
- The primer is one screen; the pledge stays on the form. If legal wants the full pledge text on the primer, it is a copy change only.
- Native mentor console — own spec next (DECISIONS §K.7 reverses §I.6 for a later phase); Mentor Home is its future front door.
- Minor review notes deferred: `HandoffStep` reuses `connecting.*` error copy; onboarding headline sizes are hand-rolled per step (a `type.*` token would unify them); a focus-refetch failure while typing in the inline form replaces it with the error card (edge case).
- Carried from session 30: Baloo 2 typeface + Clay-and-Sage tokens (fidelity pass) not started; launch-copy promises ("readable offline soon", "early access"); Module B naming.

**Next:** merge `feat/role-fork` into master (finishing-a-development-branch), then the fidelity pass (Baloo 2, Clay-and-Sage tokens, companion assets, haptics, immersive chat) with browser mockups, then the native mentor console spec.

**How to resume:** branch `feat/role-fork` is complete and reviewed; `git log master..feat/role-fork` lists the 13 commits. Stack unchanged (mento-stack); Expo must be restarted (`-c`) after switching branches because `app/mentor-home.tsx` is a new route. Proof: `node e2e\role-fork.e2e.js` after the standard reset. The brainstorm visual-companion server (port 8765, `.superpowers/` gitignored) may still be running; harmless.

---

## 2026-09-04 (session 30) — Full screen audit + v1 navigation finalised ✅

**Context:** founder asked "how many screens do we have, how are we making the experience better — go through the app, check everything, then finalise UI navigation." Ran a screen-by-screen headless walk (scratchpad script, 390×844) that drove real onboarding → chat, every options sub-flow, all four tabs, the Pathfinder to path-home, every journal, coffee, apply, reflection, start-fresh, the legacy stubs, `/apply`, `/listener`, `/admin`, and a bogus URL: **45 rendered states, 0 page errors, 0 console errors.** Inventory: 24 route files (3 layouts) → 19 real routes (5 were redirect stubs); member app 15, public web 1, listener console 2, admin 1 (7 panels). Four decisions put to the founder via `AskUserQuestion`; all ratified in `docs/DECISIONS.md` §K.

**Done:**
- **`63534be`** — feat(mobile): finalise v1 navigation.
  - **Wording → "mentor"** in every member-facing EN + HI string (landing "with a mentor who", connecting, chat header, Path "N mentors around", Profile "Mentors, not therapists", become-a-mentor funnel, `/apply` copy). Founder chose *mentor* over the recommended *listener*; "listener" stays the internal/code/console term — no route, testID, API or DB rename.
  - **New Chat FAB → two-option sheet** (`chats.tsx`: "Talk to whoever's free now" / "Choose a mentor" → Browse / "Not right now"). Before: one tap silently minted a second live General conversation.
  - **`app/+not-found.tsx`** — branded unmatched-route screen (member's companion, calm copy, "Take me back" → `/` → live session lands on `/chats`). Before: expo-router's black default page.
  - **Deleted** `onboarding/{age,email,companion,ready,connecting}.tsx` stubs; README + CLAUDE.md layout updated.
  - **Conversation Options un-numbered** ("Lock this Conversation", not "1. Lock…"); `mentors.tsx` busy/network notes now `t('common.allBusy')` / `t('common.networkError')`.
  - **Proven:** `tsc --noEmit` clean; e2e `member-screens` (extended with `chats: new-chat sheet` + `not-found` visits), `path-communities` (assertion updated `text=listener` → `text=mentor`), `connecting-experience`, `listener-apply`, `apply`, `hindi-core-loop` — all PASS, 0 page errors, normal + reduced-motion. API untouched → no pytest/reseed.
- Docs: `DECISIONS.md` §K (four rulings + the two Calm-default calls), `CLAUDE.md` vocabulary rule + Module-B-naming drift line.
- **Visual revamp, round 0 (concept art) — direction CHOSEN.** Founder asked for a "complete revamp, 3 versions, free/cheap models". Higgsfield account has no unlimited allowance, so used Nano Banana (1 credit/image; Z Image at 0.15 was rejected as too stylised for UI text). Rendered 3 directions × 4 screens, then 4 blends × 3 screens on request, then the chosen style × 8 more screens — 37 credits total incl. 5 targeted redos (215.5 → ~178). All 32 renders + rationale on the artifact **https://claude.ai/code/artifact/1c68e534-bb75-4e18-80a3-493cba6e5a8f** (private; founder's link). Ruling in `DECISIONS.md` §K.5: **Clay and Sage surfaces + illustrated (non-clay) animals.** Renders are reference only — nothing in `apps/mobile` changed yet.

**Audit findings NOT acted on (carry):**
- Journals footer promises "readable offline **soon**"; Profile footer says "Mento · early access" — both must be true or removed before launch.
- `/reflection` and `/coffee` load standalone with no conversation context (direct URL) — harmless, low priority; guard if deep links ever get shared.
- `start-fresh.tsx` still has hardcoded EN strings (pre-existing i18n violation) — fold into `locales/*` next time that file is touched.
- Landing hero is a generic two-people illustration (founder: keep).

**Open (founder):**
- **Veto window:** un-numbered Options items; mentors.tsx i18n move (both Calm-register defaults, no question asked).
- **Module B naming:** "mentor" is now taken by volunteer listeners in v1 copy; paid Module B mentors will need a distinct user-facing name — decide before Module B spec work (also on CLAUDE.md drift list).
- **Revamp type face:** chosen direction implies one rounded geometric sans for everything (display + body); needs a face with Devanagari coverage or a paired Hindi face — founder hasn't picked; propose 2 candidates with rendered samples before swapping.
- **Revamp scope:** renders show Chats-tab and Journals-hub layouts slightly different from what's built (search field + status chips are the same; Journals shows 3 cards not 4 — model noise, not a proposal). Treat renders as mood/palette reference, keep shipped IA (DECISIONS §K.1–4).
- Carried unchanged from session 29: console-deploy CI secrets, off-box backup, Stream secret rotation, `docs/PRIVACY.md` sign-off, old public `mento` GitHub repo, `/apply` link not shared, zero real listeners in prod.

**Next (revamp, in order):** (1) derive a new token set from the chosen palette in `theme/tokens.ts` + re-map the 7 companion accents in `theme/companion.ts` so sage/terracotta become the default pair (keep the 7-colour choice); (2) pick the rounded geometric sans with Devanagari coverage (candidates: Nunito stays as fallback; evaluate Baloo 2 / Poppins-class faces) and swap `theme/tokens.ts` `font`; (3) re-bake the 5 Lottie assets through `scripts/theme_lottie.py` onto the new palette; (4) card/elevation tokens for the "matte clay" depth — shadow-only, no blur (Android rule); (5) re-run every e2e + a screenshot walk, then compare against the artifact page. Previously: founder's call — this was the "finalise navigation" checkpoint. Natural follow-ups: (a) the two launch-copy promises above, (b) rebuild + ship the consoles (`deploy/deploy-console.sh`) so `/apply` shows the new wording, (c) resume session 29's infra threads.

**How to resume:** stack unchanged (`mento-stack`). Gotcha logged this session: `apps/mobile/.env` points `EXPO_PUBLIC_API_URL` at the PC's **Tailscale IP** (100.81.203.69) — for web/e2e that only works if uvicorn runs with `--host 0.0.0.0`; a localhost-only uvicorn makes every browser API call fail while `curl localhost:8000` looks healthy. New/deleted `app/` routes need an Expo restart (`-c`) before e2e sees them. The audit walk script lives only in the session scratchpad (one-off, per mento-e2e rules) — `e2e/member-screens.e2e.js` is the committed equivalent.

---

## 2026-09-04 (session 29) — Stopped the `.env` churn; cleared the docs/CI backlog ✅

**Context:** founder was tired of `apps/mobile/.env` getting hand-edited back and forth between local/dev and prod values, and asked for a full scan of the app to knock out as much of the remaining backlog as reasonably possible in one session. Root cause: `.env.production` already existed as the correct mechanism (Expo auto-loads it over `.env` when `NODE_ENV=production`), but `docs/DEPLOYMENT_VPS.md` step 8 literally instructed editing `.env` directly, and raw `gradlew assembleRelease` never sets `NODE_ENV` (already diagnosed in `ANDROID_BUILD.md` §8f) — so releases kept getting built by hand-flipping the dev file. Founder picked which backlog bundles to tackle via `AskUserQuestion`: privacy policy + helpline check, docs reconciliation, and code/CI hygiene — all done; production-infra was scoped down to console-deploy CI only (off-box backup and Stream-secret rotation explicitly deferred, needing a credential/decision the founder wants to make deliberately, not bolted onto this session).

**Done:**
- **`22874b2`** — committed pre-existing uncommitted work found sitting in the tree: `expo-build-properties` plugin (correctly propagates `usesCleartextTraffic` into the generated Android manifest, superseding the old manual-patch workaround in `ANDROID_BUILD.md` §8g) + a new `development` EAS build profile + `expo run:android/ios` scripts.
- **`a1c9baa`** — the actual `.env` fix: added `apps/mobile/scripts/build-android-release.ps1` (sets `NODE_ENV=production` for the process, runs `expo prebuild` + `gradlew assembleRelease`, so `.env.production` auto-loads and nobody has to remember to set the env var or touch a file). Fixed `DEPLOYMENT_VPS.md` step 8 (no longer says "edit `.env`") and `ANDROID_BUILD.md` §3 to point at the script. **`.env` stays permanent local/dev, `.env.production` stays permanent prod — they never cross again.**
- **`ca03ddb`** — `services/api` had zero `pyproject.toml`/ruff config despite CLAUDE.md claiming the style was enforced. Added config, ran `black` + `ruff --fix` once (formatting/import-sort/`datetime.UTC`-alias autofixes only — 82 files touched, no behavior change), added a `lint` job to `api-ci.yml`. **Verified:** full `pytest` suite re-run **165 passed**, `alembic check` clean, `ruff check .` / `black --check .` both clean after. One manual fix needed: ruff's autofix dropped a still-used `date` import from `onboarding.py` (removed as apparently-unused under `from __future__ import annotations`) — caught by the F821 it introduced, re-added.
- **`fe927c6`** — added `docs/DECISIONS.md` §J ratifying two founder-approved, already-shipped changes that were undocumented: the communities-as-lens Path system + Chats/Path/Journals/Profile tab swap (session 17), and the in-app listener-application funnel (session 22). Drafted `docs/PRIVACY.md` (covers anonymous data model, safety-staff conversation access, Path data, AI note-sorting/PII redaction, crisis-scan processing, analytics, Panda Wipe deletion — explicitly marked as an engineering draft needing founder + legal/DPDP sign-off before publication, not a real policy yet). Re-verified Tele-MANAS (14416) and KIRAN (1800-599-0019) are still correct/active via their official MoHFW/DEPwD sources — both unchanged. Cleaned the two resolved bullets off CLAUDE.md's docs-drift list.
- **`bc34134`** — added `.github/workflows/console-deploy.yml`: auto-rebuilds and ships `/admin`, `/listener`, `/apply` on push to master touching `apps/mobile/**` (build runs on the GH runner, not the 1-2GB VPS — matches `deploy-console.sh`'s existing reasoning). **Not yet active** — deliberately did not mint or install any live SSH credential; needs two GitHub repo secrets added by hand (`MOBILE_ENV_PRODUCTION`, `CONSOLE_DEPLOY_SSH_KEY` — generate a *dedicated* deploy keypair, don't reuse the personal one). Setup steps documented in `DEPLOYMENT_VPS.md` §11.
- Reviewed the Hindi crisis-card strings (`locales/hi.json` `crisis.*` + the listener-not-therapist Tele-MANAS mention) for tone/accuracy as a best-effort pass — found them already accurate and natural, no changes needed. Note: the crisis **support-copy body and helpline names** are server-generated (`services/api/app/services/safety.py`, `config.py`) and English-only regardless of app language — this is an existing, accepted trade-off (CLAUDE.md: "chat bodies/server Path content/personas stay untranslated"), not a new gap. A real native-speaker pass on the client-side strings is still the standing recommendation before launch, unchanged from prior sessions.
- `npx tsc --noEmit` clean throughout; both new/changed GitHub workflow YAML files validated for syntax.

**Open (founder) — new:**
- **Console-deploy CI is inert until secrets exist.** Add `MOBILE_ENV_PRODUCTION` and a dedicated `CONSOLE_DEPLOY_SSH_KEY` to the GitHub repo (steps in `DEPLOYMENT_VPS.md` §11) whenever ready — until then the manual `./deploy/deploy-console.sh` path is unchanged and still the only way it ships.
- **Off-box backup + Stream secret rotation — explicitly declined again this session** (founder's direct choice when asked which prod-infra items to do today). Still carried from session 28; still needs a remote-backup target decision and a deliberate rotation window respectively.
- **`docs/PRIVACY.md` is a draft, not published** — no in-app screen/link shows it yet, and no grievance-officer contact is named (required for DPDP Act compliance). Needs founder + legal sign-off before it's real.
- Everything else carried from session 28's "Open" list untouched (old public GitHub `mento` repo still live, `/apply` link not shared anywhere, zero real listeners in prod, session 26/27 items, Higgsfield work blocked on credits).

**Next:** founder's call — likely either activate console-deploy CI (add the two secrets), pick up the off-box-backup/secret-rotation decision deliberately, or resume session 28's "share `/apply`" / Higgsfield threads.

**How to resume:** `.env` (local/dev) vs `.env.production` (prod) is now the enforced, documented split — release APKs go through `apps/mobile/scripts/build-android-release.ps1`, nothing else should touch either file. `services/api` now has `ruff`/`black` wired into CI (`services/api/pyproject.toml`) — run `black .` + `ruff check --fix .` before committing API changes to stay green. `docs/PRIVACY.md` exists but is a draft. Test/Prod environments and everything from session 28's "How to resume" (VPS access, deploy commands, git remote) are otherwise unchanged.

---

## 2026-09-04 (session 28) — Repo consolidated, GitHub remote live, first production VPS deploy (Hostinger) ✅

**Context:** founder moving from local-host-only dev toward production. Two duplicate project folders existed on the machine (`Desktop\Mento` and `~\mento`) — needed a single source of truth before anything else. Founder's plan: keep **Test** (laptop/localhost, unchanged) and **Prod** (a self-managed Hostinger VPS, not a PaaS) as the two permanent environments, with a repeatable Test→Prod deploy process. Infra-only session — no app code touched, so verification here means live end-to-end proof (health checks, a real crisis-webhook round-trip, a real backup dump) rather than pytest/tsc.

**Done:**
- **Source-of-truth consolidation**: verified via `git merge-base --is-ancestor` that `Desktop\Mento` is the current, sole valid copy; archived `~\mento` to `~\mento-archive-2026-08-29` (git history intact, verified `git log -1` post-move). Windows gotcha: `.git` internals are read-only/system/hidden and silently fail a plain `Move-Item` — needs `attrib -R -S -H ... /S /D` first.
- **Private GitHub remote**: created `github.com/trendywink247-afk/mento-app` (private) and pushed `master`. Found the account already had a repo literally named `mento` — investigated before touching it, confirmed it's an unrelated abandoned Next.js/NestJS/Prisma prototype (different stack, last pushed 2026-05-14, predates this project) and public — left it untouched; used `mento-app` instead per founder's call. `gh` CLI had to be invoked by full path (`C:\Program Files\GitHub CLI\gh.exe`) — PATH doesn't refresh in already-running shells post-winget-install.
- **`docs/DEPLOYMENT_VPS.md` written and then fully executed against a real box** — Hostinger VPS, Debian 12 (bookworm), ~2GB RAM, 30GB disk, `87.232.72.79`, domain `api.agentin.chat` (owned via Namecheap; `geekspace.space` also on hand, unused). Every one-time-setup step done live over SSH from this machine:
  - Base hardening: `mento-ops` user (passwordless, key-only — needed an explicit `NOPASSWD` sudoers rule since a keyless account can't do interactive-password sudo), UFW (22/80/443 only), 2GB swap file (RAM is below the original 4GB target).
  - Docker 29.8, Nginx, certbot installed.
  - Repo cloned via a dedicated **SSH deploy key** (pull-only, repo-scoped) generated on the VPS itself — chosen over a PAT.
  - Prod secrets generated (`JWT_SECRET`/`ADMIN_JWT_SECRET`/`POSTGRES_PASSWORD`, all distinct random hex) and low-RAM tuning applied (`UVICORN_WORKERS=1`, `DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2`). New Stream Chat app created for prod (separate from the dev app — a shared app would force the crisis webhook to point at only one environment).
  - **First deploy succeeded** after fixing two real scaffolding bugs (see Gotchas): all 9 migrations ran clean, `/api/v1/health` → ok.
  - Nginx reverse proxy + certbot TLS — `https://api.agentin.chat` live, HTTP→HTTPS redirect, cert to 2026-12-03, auto-renewal scheduled.
  - Stream webhooks pointed at prod (`scripts.configure_stream`, run via `docker cp` into the container since `scripts/` is deliberately excluded from the prod image).
  - **Crisis pipeline proven live in prod** (not just configured) via a throwaway script sent straight through the Stream server SDK, bypassing any app UI: benign message → no flag; crisis-phrased message → `SafetyFlag` written (signal-only, `matched_terms=suicidal`, never the body) + client payload correctly augmented with support copy/helplines. `/api/v1/health/crisis` confirmed `"ok"` with a fresh timestamp. All test data cleaned up after.
  - Nightly Postgres backup cron installed (`0 3 * * *`, 14-day local retention) — test-ran manually first, verified valid gzip + 14 tables in the dump.
  - UptimeRobot monitor added on `/api/v1/health/crisis`.
- **Gotchas fixed in the deploy scaffolding itself** (commits `c14a229`, `e54a6c9`, pushed): (1) `docker compose`'s `${POSTGRES_PASSWORD}` YAML interpolation is NOT satisfied by a service's `env_file:` — it needs `--env-file` on the CLI invocation itself; added to `deploy.sh`. (2) Windows doesn't track the unix executable bit, so every `git reset --hard` on the VPS silently reset `deploy.sh` back to non-executable — fixed permanently with `git update-index --chmod=+x`. (3) `scripts.configure_stream`'s base-URL argument must NOT include `/api/v1` (the script appends the full path itself) — first attempt produced a doubled `/api/v1/api/v1/stream/...` URL, caught before trusting it. (4) Hostinger/Virtualizor's panel "SSH Keys" feature only injects into a running VPS on a full **stop/start**, not a warm reboot — cost two reboot cycles before falling back to a one-time password bootstrap (via a locally-installed `paramiko`, since neither `sshpass`/`plink`/`expect` were available) to seed the key manually.
- `docs/DEPLOYMENT_VPS.md`, `deploy/docker-compose.prod.yml` (added `mem_limit` per service sized for the real 1-2GB box), `deploy/deploy.sh`, `deploy/nginx/mento-api.conf.template` all reconciled against the real VPS (Debian not Ubuntu, real domain throughout, deploy-key clone instructions, low-RAM tuning) — committed as `62aca35`, `8d24d62`, `c14a229`, `e54a6c9`.
- **Mobile app proven end-to-end against prod**: temporarily pointed `apps/mobile/.env` at `https://api.agentin.chat` + the prod Stream key, temporarily allowed `http://localhost:8081` in prod's `CORS_ORIGINS` (browser-enforced, blocks the web test surface otherwise), seeded 3 throwaway listeners on prod, then ran `connecting-experience.e2e.js` for real — full onboarding → General match → live chat, both normal and reduced-motion, **0 page errors**. Gotcha confirmed live: `postgres` and `api` share one `env_file:` in `docker-compose.prod.yml`, so editing it bounces **both** containers on the next `up -d`, not just `api` (data safe — named volume persists — but a few seconds of downtime each time; matters if this happens during real traffic later). Fully cleaned up after: Stream test channels wiped, all test rows truncated from every prod table, `.env`/CORS reverted, local Expo dev server killed (it had prod env baked into its already-running process — a restart, not just a file edit, is required to pick up reverted values).
- **Admin dashboard + listener console shipped to prod** — founder asked "where does the app and consoles live" and the honest answer was "nowhere but your laptop," so built and deployed them: `npx expo export --platform web` (built locally — the VPS's 1-2GB RAM can't reliably run the Metro toolchain) → uploaded to `/opt/mento-console/current` → Nginx + certbot TLS at `console.agentin.chat` (new DNS A record + cert, same pattern as `api.`). **Caught a real exposure before it mattered**: `apps/mobile` builds as one SPA (`web.output: "single"`), so the FIRST Nginx config served every route — founder navigated to `console.agentin.chat/onboarding` and it genuinely tried to run the anonymous-chat matching flow against prod (mobile-only by design; web is dev/test-only per CLAUDE.md). Fixed by rewriting Nginx to allow-list only `/admin` + `/listener` (+ their static assets) and 404 everything else, including `/` itself — verified via curl (member routes → 404, console routes → 200) and a real headless-browser pass (0 console errors on both). Root-caused a config bug along the way: `try_files`'s final `/index.html` fallback re-enters Nginx location matching, so it needs its own exact-match rule or it falls into a catch-all `location /` 404.
- **`deploy/deploy-console.sh` + `deploy/nginx/mento-console.conf` committed** so this is repeatable, not a one-off SSH session: the script builds from `apps/mobile/.env.production` (gitignored, new — auto-loaded by `expo export`'s default production mode, so no inline env vars or touching the dev `.env`), uploads, atomically swaps `current`, and verifies both routes 200 before declaring success. Deliberately **separate** from `deploy.sh` (API-only) — no CI wiring yet, run manually after any `/admin` or `/listener` UI change. `docs/DEPLOYMENT_VPS.md` gained step 11 for this; also fixed a stale instruction found in passing (backup cron's log path was `/var/log/...`, which `mento-ops` can't write to — corrected to `/opt/mento-backups/backup.log`, matching what was actually installed).
- **Minted the first prod admin token** (`scripts.issue_admin_token --owner`, via `docker cp` + `docker compose exec`, same pattern as `configure_stream`) — the admin dashboard is now actually usable, not just reachable. Token handed to the founder directly (bearer, no reset flow — treat it like a password).
- **Public listener-recruitment landing page shipped** (`console.agentin.chat/apply`, commit `92a31ab`) — founder wanted a way to recruit listeners that doesn't force them through the member app's onboarding to find a buried Profile row. Brainstormed via plan mode; the key finding that shaped the whole design: `POST /listener-applications` hard-requires a real `User` row (the admin queue's `admin_applications` does an INNER JOIN against `User`; `approve_application` 404s without one), but `POST /onboarding/start` is *already* a public, rate-limited, 18+-age-gated endpoint that mints a throwaway anonymous `User`. So `/apply` mints one of those, then submits through the **existing, unmodified** application endpoint — **zero backend changes, zero migrations**. Extracted the shared form fields into `components/ApplicationForm.tsx` (used by both the new page and the existing member-flow screen; testIDs preserved so `listener-apply.e2e.js` needed no edits). New `e2e/apply.e2e.js`: underage DOB correctly leaves the continue button disabled, valid DOB → form → submit, normal + reduced-motion + a 1280×800 desktop smoke pass, plus an admin-queue leg — all green locally. **Verified live on prod**, not just locally: submitted a real test application through a real browser against `https://console.agentin.chat/apply`, confirmed it appeared in the prod admin queue (the throwaway-user join working for real, not just in dev), declined it to clean up. Accepted limitation, documented in CLAUDE.md: the 3/24h + 30-day reapply limits are keyed on `user_id`, and public submissions mint a fresh one each time — a declined public applicant could trivially resubmit. Not solved (admin review already screens).

**Open (founder) — new:**
- **Off-box backup destination not configured** — the `rclone` line in `backup-postgres.sh` is still a placeholder; a VPS disk failure loses everything past the 14-day local window. Explicitly deferred this session ("leave it for later").
- **Prod Stream Chat secret was pasted in chat during setup** — flagged with an inline rotate-reminder comment in the VPS's `.env` itself (same convention as the pre-existing dev-secret note); not urgent, do whenever convenient.
- **`/api/v1/health/crisis` will show "down" on UptimeRobot within ~30 min of this session ending** and stay down until real chat traffic exists — by design (it tracks live webhook traffic, not just liveness), not a bug. Founder should expect and ignore that first alert.
- The old public GitHub `mento` repo (unrelated prototype) is still live and untouched on the account — no action taken, just flagging it still exists.
- Carried, untouched this session: everything from session 27 (Tailscale VPN routing unreliable on the test device; ephemeral `cloudflared` tunnel; `usesCleartextTraffic` manifest patch; session 26's AI decisions, OTA server standup, pilot/DO provisioning, privacy policy, helpline re-verify).
- **Higgsfield UI work requested this session, not started**: founder asked for both a marketing hero-shot pack (`docs/HERO_IMAGE_PROMPTS.md` is ready to run, blocked on a Higgsfield credit top-up — account currently at 0 credits/free plan) and an in-app companion-art refresh (bigger scope, not yet broken down) — resume when credits are topped up / scope is ready.
- **Prod DB has no real users yet** — one admin account (the founder's owner token) and one declined test `ListenerApplication` (+ its throwaway `User`, from verifying `/apply` live) are the only rows. Zero real listeners. Real matching won't succeed against prod until at least one listener is approved through the admin console. Don't mistake this for a bug if `console.agentin.chat` or the API is checked cold.
- **Console redeploy is manual, not wired to CI** — any future `/admin`, `/listener`, or `/apply` UI change needs a founder/session to remember to run `./deploy/deploy-console.sh` after `deploy.sh`; the two are independent and nothing currently enforces staying in sync. Same goes for `deploy/nginx/mento-console.conf` changes (a new allow-listed route needs a manual `scp` + `nginx reload` — see `docs/DEPLOYMENT_VPS.md` step 11).
- **`/apply`'s recruitment link isn't shared anywhere yet** — the page is live and verified, but nothing points at it (no social post, no ad, no QR). Ready whenever the founder wants to start recruiting.
- **Public-applicant console-link delivery is manual by founder's explicit choice** (asked directly this session): since public `/apply` applicants never install the app, there's no in-app "approved" card to deliver their console link the way the member-flow path does — someone has to copy it from the admin panel's existing "get console link" action and send it to the applicant's email by hand. Founder confirmed staying manual for now rather than standing up an email-sending provider (real new dependency: provider account, sending domain, SPF/DKIM) — revisit once listener volume makes manual copy-paste painful.

**Next:** share the `/apply` link somewhere real to start recruiting listeners; set up the `rclone` off-box backup target; then the still-open session 26/27 items (OTA server, pilot decisions) or the Higgsfield work.

**How to resume:** Prod is live and healthy — API at `https://api.agentin.chat`, console at `https://console.agentin.chat/admin`, `/listener`, and `/apply` (everything else on that domain 404s by design). A prod owner admin token exists (given directly to the founder — not re-printed here; re-mint via `scripts.issue_admin_token --admin-id <uuid>` if lost, uuid is in the admin's audit trail). `ssh mento-ops@87.232.72.79` (key-based, this machine's `~/.ssh/id_ed25519` is already trusted; root SSH deliberately left open too as a fallback, per founder). Redeploy API changes with `ssh mento-ops@87.232.72.79 'cd /opt/mento && ./deploy/deploy.sh'`; redeploy console/apply UI changes with `./deploy/deploy-console.sh` (run locally, not on the VPS) — remember to also push a Nginx conf change manually if the allow-list itself changed. Local git remote: `origin` = `github.com/trendywink247-afk/mento-app` (private), branch `master`, in sync as of `92a31ab`. Test environment (laptop/localhost) is completely unchanged by any of this — `apps/mobile/.env` still points at the Tailscale dev URL, `.env.production` (gitignored) is prod-only and never touched by `expo start`.

---

## 2026-08-16 (session 27) — First real-device standalone APK: local build + connectivity debugging saga ✅

**Context:** direct continuation of session 26's WS-4 (standalone APK runbook). Founder asked to actually get a working APK onto their physical Android phone (wireless-adb, rooted/KernelSU device connected via Tailscale). This was the first time the local-build path (`docs/ANDROID_BUILD.md`) was exercised end-to-end against real hardware, and it surfaced a long chain of environment issues the runbook hadn't seen yet — each is now documented so it's a 5-minute fix next time, not a rediscovery.

**Done:**
- **Toolchain from scratch:** Android Studio (winget) for the SDK reference, but its bundled JBR (JDK 25) is too new for Gradle 8.10.2 — installed Temurin **JDK 17** separately (winget). Downloaded Android SDK **command-line tools** directly from Google (avoids the interactive first-run wizard) and installed `platform-tools` / `platforms;android-35` / `build-tools;35.0.0` headlessly via `sdkmanager`. `ANDROID_HOME`/`JAVA_HOME` set persistently; `android/local.properties` written.
- **Wireless adb** paired + connected over Tailscale (`adb pair`/`adb connect`); re-paired several times over the session as the connect port rotated and WiFi was toggled for testing.
- **Native android/ project generated** (`expo prebuild`), **debug APK built and installed** first (confirmed the dev-client launcher screen, not the standalone experience wanted), then **release APK built** (JS bundled in, no Metro dependency) — hit and fixed, in order: Controlled-Folder-Access silently blocking Gradle (GUI-only fix, PowerShell/registry no-op under Tamper Protection), a full disk mid-build, a Sentry-upload-on-release failure (`SENTRY_DISABLE_AUTO_UPLOAD=true`), and Reanimated's Windows `MAX_PATH` ninja failure — which **neither a junction nor a `subst` drive fixed** (JVM canonicalizes both back to the real path); the only working fix was a **real physical copy** of `apps/mobile` to `C:\mento-build`. Two more bugs surfaced from that relocation itself (an over-broad robocopy `/XD "build"` exclusion, and stale generated `android/build` config carrying the old absolute path) — both fixed, documented.
- **Two silent-runtime-config bugs found only by testing on real hardware** (never surfaced in web/e2e): (1) `NODE_ENV=production` isn't set by a raw `gradlew assembleRelease` the way `eas build` sets it automatically, so `EXPO_PUBLIC_API_URL` never got inlined into the release bundle — the app silently fell back to `http://localhost:8000` (i.e. the phone's own loopback) with no error hinting the URL was wrong; (2) `usesCleartextTraffic="true"` only exists in the React Native template's **debug**-variant manifest by default — `app.json`'s setting didn't propagate to the base manifest, so the release build defaulted to Android's block-all-cleartext policy. `curl` via `adb shell` falsely "proved" connectivity was fine in both cases (different process/UID, unbound by the app's own network/env config) — a real trap, now called out explicitly in the runbook.
- **Tailscale VPN per-app UID exclusion**, diagnosed with hard kernel-level evidence: `dumpsys connectivity`'s VPN `Uids:` allow-list had a gap excluding the freshly-installed app; even after fixing the UID range AND forcing Android's system-level Always-on-VPN + lockdown (`settings put global always_on_vpn_app`/`always_on_vpn_lockdown`), the app's socket **still** sourced from the WiFi interface instead of the tunnel (proven by polling `/proc/net/tcp` for the literal socket state — `SYN_SENT`, wrong local IP). Not root-caused on this specific device/Tailscale combo. **Unblocked with a `cloudflared` quick tunnel** (real public HTTPS, zero signup) pointed at from `EXPO_PUBLIC_API_URL` instead — works from any network, sidesteps VPN routing and the cleartext issue at once.
- **Verified end-to-end on the real phone:** onboarding → connecting → matched → a genuine `active` conversation row landed in the database from an actual device test (not a simulation). Diagnostic scaffolding (temporary `console.error`, widened 45s timeout) fully reverted — `git diff` on both touched files is empty, confirming a clean return to the committed baseline.
- **`docs/ANDROID_BUILD.md` gained a full "Troubleshooting — gotchas hit in practice" section (§8)** — every issue above, with symptoms, root cause, dead ends to skip, and the actual fix. This is the valuable output of the session; read it before touching a local Android build again.
- **Re-verified after cleanup:** pytest 165 passed, `alembic check` clean, `tsc --noEmit` clean, e2e (connecting-experience, member-screens, journal-organize) all green normal + reduced-motion, 0 page errors. Listeners re-seeded.

**Open (founder) — new:**
- **Tailscale VPN routing is unreliable on the test device** (app socket sourced from WiFi instead of tun0 even with lockdown mode forced) — not root-caused; either investigate further (Tailscale Android client version, this device's custom ROM/KernelSU interaction) or standardize on the self-hosted-OTA path from §4 (no Tailscale dependency for phone↔PC connectivity once that server exists) for future device testing.
- **The `cloudflared` tunnel used to unblock this session is ephemeral** — it dies when the background process ends and the URL isn't stable. Not wired into any permanent config; a real fix needs either the Tailscale routing sorted, a stable self-hosted OTA/API endpoint, or a durable tunnel (Cloudflare named tunnel, not quick tunnel).
- **`app.json`'s `android.usesCleartextTraffic` not propagating to the base manifest** — patched by hand-editing the generated manifest for this build only; the underlying Expo config-plugin behavior isn't fixed, so `expo prebuild` will regenerate a manifest missing it again next time unless a proper fix (e.g. a config plugin, or targeting HTTPS-only backends) lands.
- Carried: everything from session 26 (AI decisions on redaction fail-open / Gemini-vs-Claude / Presidio install; APK/OTA server standup; pilot, DO provisioning, privacy policy, helpline re-verify).

**Next:** decide the long-term device-testing connectivity story (fix Tailscale vs. stand up self-hosted OTA vs. accept periodic `cloudflared` tunnels); otherwise unchanged from session 26.

**How to resume:** a working release APK exists at `C:\mento-build\mobile\android\app\build\outputs\apk\release\app-release.apk`, built against a `cloudflared` tunnel URL that **will not survive this session ending** — rebuild with a fresh tunnel URL (or a real endpoint) before assuming that exact APK still connects. `C:\mento-build\mobile` is a *build workspace copy*, not the live project — re-sync from `apps/mobile` (robocopy, `.cxx`-only exclusion, purge stale `android/build`+`.cxx` per §8d/8e) before rebuilding after any source change. Stack: API :8000 and Expo web :8081 both restarted mid-session (died under build CPU load) — verify both are actually up before assuming a "stuck" flow is a real bug.

---

## 2026-08-16 (session 26) — Onboarding polish, full QA sweep, in-chat AI (PII redaction + note-sorting), standalone-APK runbook ✅

**Context:** founder asked (deadline slipped) to: fix onboarding screens that flash / scroll-bounce; do a real in-and-out QA pass with dummy members + mentors talking; add AI to (a) auto-redact sensitive PII before delivery and (b) sort journal notes; and escape the Expo Go dependency with a self-updating standalone APK, cost-consciously. Four Q&A decisions locked up front: **moderation = LOCAL PII detection** (no cloud, honours T&S #6/#7), **action = auto-redact then deliver**, **note-sorting = opt-in cloud LLM**, **APK = local build + self-hosted OTA** (avoid EAS cloud cost; Expo SDK is free and stays).

**Done (per commit, all gates green before each):**
- **Onboarding polish** (`5979931`): `StepScaffold` ScrollView is now non-bouncing and only scroll-enabled when measured content exceeds the viewport (`onLayout`+`onContentSizeChange`) — kills the idle rubber-band on every step at once while keeping real scroll where content overflows. Found-listener beat retuned from a ~1.6s flash to a deliberate ~2.1s moment (`ConnectingStep` FOUND_CRESCENDO 700→1100, journey FOUND_BEAT 900→1000). `connecting-experience.e2e` now asserts found-card dwell ≥1500ms **and** adds the previously-missing reduced-motion pass. Verified: tsc clean; e2e green (found held 1970ms); age-step scroll container proven `overflow:hidden`/can't-scroll via DOM probe.
- **Member-screens QA sweep** (`—`, `member-screens.e2e.js`): discovery-oriented spec completes onboarding once, then sweeps all 13 member screens/sub-flows (chat+options, 4 tabs, every journal channel, coffee incl. the disabled-payment note, start-fresh, reflection), attributing page errors per-screen. **Every screen renders, 0 page errors, normal + reduced.**
- **PII auto-redaction** (`—`, WS-3a): new `app/services/moderation.py` — stable `redact(text)→RedactionResult`, regex layer (Indian phone/id, email, age, name-introductions incl. Devanagari, zero deps) + optional Presidio/spaCy NER that auto-detects its install and degrades gracefully (`requirements-ml.txt`). Wired into `stream_hooks.before_message_send`: crisis scan reads the ORIGINAL text, redaction rewrites the DELIVERED text + attaches a `moderation` payload, composes with the crisis card, **fail-open**, nothing persisted (signal-only Redis counter). Config `pii_redaction_enabled`/`pii_use_presidio` (default on). 18 unit + 2 before-send integration tests.
- **Two-party live chat** (`—`, `two-party-chat.e2e.js`): member (onboarded) ↔ listener (console dev-picker) exchange messages **both ways over real Stream** — delivery confirmed each direction, 0 page errors. Proves the core talking loop. (Live redaction/crisis on the wire additionally needs Stream's before-send webhook on a public tunnel — logic proven by pytest.)
- **Admin dashboard smoke** (`—`, `admin-dashboard.e2e.js`): token auth + all 7 tabs render, 0 page errors.
- **Note-sorting AI** (`—`, WS-3b): `app/services/notes_ai.py` (raw-HTTP Gemini Flash, dark until `gemini_api_key` set) + `POST /journals/organize` (enabled-gated 503, restricted to the user's own mood/finance/gratitude — never mentor-notes/chat, needs ≥2 entries). Mobile: journals AI card now tappable (Beta) → new `/journal/organize` screen (pick channel → overview+themes, or friendly "not switched on yet"). EN+HI strings, typed `api.organizeNotes`. 4 endpoint tests; `journal-organize.e2e` green (normal+reduced).
- **Standalone-APK runbook** (`—`, WS-4): `docs/ANDROID_BUILD.md` — clears the Expo-cost myth, Windows prereqs, `expo prebuild`+Gradle local APK, sideload, free self-hosted OTA (xprem/Xavia) + the exact `app.json` `updates` block, publish, verify shake-to-update; teleport-patch caveat + EAS-free-tier fallback. `app.json` intentionally unchanged (APK builds/installs today; shake inert until an `updates.url` server exists).
- **Verified (final):** pytest **161→165**, `alembic check` clean, listeners re-seeded, `tsc --noEmit` clean; e2e green — connecting-experience, member-screens, journal-organize (all normal+reduced), plus two-party-chat + admin-dashboard (special-setup). **QA result: zero app defects surfaced across every driven surface** — the only issues in the sweep were test-selector mistakes, fixed.

**Open (founder) — new:**
- **Redaction is fail-open** (on detector error, PII may pass) to preserve never-hard-block-a-support-conversation — confirm acceptable. Also: redaction is silent (the masked text is its own transparency — sender sees "[name hidden]" in their own bubble); a subtle "personal info hidden" chip could be added later.
- **Note-sorting provider** defaults to **Gemini Flash** (cost/free-tier) vs Claude Haiku (house model policy) — confirm; and whether the organizer may ever process `mentor_notes` (currently hard-restricted to the user's own entries).
- **Presidio NER** ships off unless `requirements-ml.txt` is installed — regex layer covers phone/email/age/name-intros meanwhile; decide whether to install NER for bare-name coverage before launch.
- **APK/OTA:** founder runs the local Gradle build (Android SDK on the machine) and stands up the OTA server; `updates.url` block (per `docs/ANDROID_BUILD.md`) is the one remaining config for live shake-update.
- Carried: everything from session 25 (push-send trigger; Hindi crisis-card native review; DO provisioning; DECISIONS §J + listener-application ruling; privacy policy incl. now safety-staff access + AI note-processing disclosure; helpline re-verify; Razorpay creds; native perf gate).

**Next:** founder rules on the open AI decisions + provides `GEMINI_API_KEY` (note-sort goes live instantly); stands up the OTA server for shake-update; then unchanged from session 25 (pilot, DO provisioning).

**How to resume:** stack RUNNING (API :8000 restarted this session with the new `/journals/organize` route + moderation wiring, Expo web :8081, containers healthy, listeners seeded, Redis flushed). Two-party + admin e2e need setup blocks documented in their file headers (real Stream creds / one online listener / an admin token). **Gotcha re-hit:** running `pytest` truncates dev-DB listeners → match 503s → onboarding e2e stalls at `waitForURL('**/chat/**')`; always re-seed after pytest (cost me a debug cycle this session — the empty listeners table looked like an app bug). New optional dep manifest: `services/api/requirements-ml.txt` (Presidio).

---

## 2026-08-15 (session 25) — Push notifications v1 test pass + EAS Update check-for-updates, mobile wiring completed ✅

**Context:** resumed a session that was interrupted mid-feature — backend (push-token model/router/migration/script/tests) and mobile deps/config (`expo-notifications`, `expo-updates`, `expo-device`, `eas.json`, `app.json` plugins, `updates.*` locale strings) were already in the working tree, but nothing on the mobile client actually called the register-token endpoint or used the update strings.

**Done:**
- **Mobile push registration** (`lib/pushNotifications.ts`): native-only, best-effort — `Device.isDevice` + permission check → `Notifications.getExpoPushTokenAsync()` → `api.registerPushToken()`. Never throws to the caller: a denied permission, a simulator, or the still-unlinked EAS project (`extra.eas.projectId` unset pre-`eas init`) are all silent no-ops, not errors — this isn't a safety-critical path like the crisis scan. Fired once from `(tabs)/_layout.tsx` after `useSessionGuard` confirms a live session.
- **`api.registerPushToken`** added to `lib/api.ts` (typed client, matches `PushTokenIn`).
- **Manual "Check for updates" row** in Profile (`profile.tsx`), native-only (`Platform.OS !== 'web'` — `Updates.isEnabled` is false on web/dev-client anyway): checking → downloading → restarting → up-to-date/failed, using the `updates.*` strings that were already sitting unused in en.json. No auto-check-on-launch (would be a silent surprise mid-session).
- **Hindi parity**: added `profile.updatesTitle/updatesBody` and the `updates.*` block to `hi.json` — it had zero Hindi translation for keys en.json already carried (fallback would have silently rendered English; fixed to keep the session-24 en/hi-parity discipline).
- **Verified per mento-verify:** pytest **137 → 141** (4 new `test_notifications.py` cases, pre-existing but now confirmed passing), `alembic check` clean, listeners re-seeded, `tsc --noEmit` clean, API boots healthy with the new route live (`/api/v1/notifications/register-token` in the OpenAPI schema). Scratch Playwright probe (onboard → Profile, normal + reduced-motion): 0 page errors, confirms the updates row correctly stays hidden on web and push-registration's web no-op never throws. Re-ran the committed `e2e/listener-apply.e2e.js` (touches the same Profile screen) both motion modes: still 0 page errors.
- **Gotcha re-hit and fixed:** `apps/mobile/.env` had drifted to a third stale LAN IP (`192.168.0.112`, gitignored so invisible to `git status`) — caused every onboarding API call to hang silently (`waitForURL('**/chat/**')` timeout, no request ever reached uvicorn). Same failure mode as the session-24 note; reset to `localhost` for web/e2e work per `mento-stack`'s repair table.

**Open (founder) — new:**
- **EAS project not yet linked** (`eas init` never run — `eas.json` has no `projectId`, `app.json` has no `extra.eas.projectId`). Push tokens will silently fail to register until it is; OTA updates similarly need an EAS project + `eas update` channel before "Check for updates" can ever find one. Low urgency — ships dark, same pattern as PostHog/Sentry/Razorpay creds.
- Push notifications remain **registration-only** by design (router docstring): there's no product-triggered send yet, only the manual `scripts/send_test_push.py`. Deciding what actually triggers a push (new message while backgrounded? crisis follow-up?) is a future scope call, not decided here.
- Carried: everything from session 24 (Hindi crisis-card native-speaker review, DO provisioning, email provider, DECISIONS §J + listener-application ruling, privacy policy, helpline re-verify, Razorpay creds, LLM decision, native perf gate).

**Next:** founder decides push-send triggers and whether/when to run `eas init` + provision an EAS Update channel; otherwise unchanged from session 24 (pilot D1–D7, DO provisioning).

**How to resume:** stack RUNNING (API :8000, Expo web :8081 restarted with `-c` this session, containers healthy, listeners seeded, Redis flushed). `apps/mobile/.env` reset to `localhost` (not the stale `192.168.0.112` this session found) — re-verify with `curl http://localhost:8000/api/v1/health` before assuming a "stuck" flow is a real bug.

---

## 2026-07-30 (session 24) — Session-22 fixes + the whole H1-remainder PRD executed: analytics, Sentry, deploy spec, Hindi ✅

**Context:** "continue where we left off" after the session-23 pilot review. The logged Next converged on the two session-22 open fixes plus `docs/superpowers/plans/2026-07-20-h1-remainder-prd.md` top-to-bottom (also the pilot plan's Week-0 prerequisites).

**Done (per commit, all gates green before each):**
- **Listener provisioning fixes** (`b41fcee`): admin-created and application-approved listeners now `stream.upsert_user` after commit (onboarding's phasing) — previously only `seed_listeners` did, so a fresh prod listener's first channel would fail; members who became listeners are excluded from their own matcher pool, Browse list, and Personal-request path (`_own_listener_ids` via `listener_applications.listener_id`). 5 new tests (`test_listener_provisioning.py`); **pytest 132 → 137**, alembic clean, re-seeded.
- **Milestone A — PostHog funnel, dark** (`73723e0`): `lib/analytics.ts` (raw HTTP capture, no SDK, closed event/prop union — PII props are compile errors, proven by a temporary probe file; random persisted `mento.analytics_id`), journey instrumented at existing success points (landing → age → email(skipped) → companion → completed → match_requested/found(bucketed wait, one-shot latch on 503 retries) → first message → reflection + path_chosen). New `e2e/analytics-dark.e2e.js`: full journey with no key = **0 PostHog requests, 0 page errors**.
- **Milestone B — Sentry + deploy** (`6e92fb6`, `c5e245b`): API `sentry-sdk[fastapi]==2.66.1` env-gated (errors-only, `send_default_pii=False`, `before_send` strips request bodies); mobile `@sentry/react-native` in both AppProviders variants behind a guarded require (SDK never evaluates when `EXPO_PUBLIC_SENTRY_DSN` empty — Expo Go boot-safe); `deploy/do-app.yaml` (secrets as slots, `/api/v1/health` check, PRE_DEPLOY migrate job; entrypoint gained one-off arg mode); DEPLOYMENT.md gained the DO runbook, Sentry known-gap note replaced. Image rebuilt + smoke-booted: `{"status":"ok"}`. **PRD deviations (deliberate):** B3 skipped (session 20 already shipped the Dockerfile); extended existing `docs/DEPLOYMENT.md` instead of creating `DEPLOY.md`; `do-app.yaml` carries `ADMIN_JWT_SECRET` not the PRD's `ADMIN_TOKEN` (deleted session 19).
- **Milestone C — Hindi** (`e162b17`, `303d52f`, `33079ff`): `lib/i18n.tsx` (i18n-js, compile-checked dotted keys + `%{var}` interpolation, persisted `mento.lang` → device locale → en, web `?lang=` e2e hook), Noto Sans Devanagari 400/700 via the existing expo-google-fonts mechanism (PRD said raw asset files — mirrored the established loader instead) + `font.devanagari*` tokens; full extraction of core loop + tabs (**380 keys, en/hi parity**; C3–C5 landed as one commit, executed via subagent with independent re-verification); Profile gains the live English/हिंदी toggle. New `e2e/hindi-core-loop.e2e.js` green **twice in a row** (normal pass asserts Hindi at every stage; reduced-motion pass completes), toggle probed both directions, hi landing screenshotted (Devanagari clean).
- **Milestone D** (this commit): CLAUDE.md reconciled (PostHog/Sentry/i18n stack rows, env vars incl. `ADMIN_JWT_SECRET`, repo layout `locales/` + `deploy/` + 2 new e2e, i18n/analytics conventions bullet, pytest hint 54→137); mento-stack repair table gained the stale-LAN-IP row.
- **Verified (final state):** pytest **137**, `alembic check` clean, listeners re-seeded, `tsc --noEmit` clean, all four e2e suites green with 0 page errors (connecting-experience, path-communities incl. reduced-motion, analytics-dark, hindi-core-loop ×2), Docker image boots healthy.

**Open (founder) — new:**
- **Hindi crisis-card copy needs native-speaker review before launch** (launch gate, same tier as the privacy policy). Also flag: Panda Mask/Pause/Wipe transliterated (पांडा मास्क…), "Path" = "राह", listener = "सुनने वाले" — veto welcome.
- **Server-driven Path content localization** deferred by design (community names/stages/prompts arrive EN from the API; no locale param added).
- **Lora has no Devanagari** — hi display text renders in bold Noto sans instead of the serif; aesthetic call logged per PRD.
- **DO provisioning + real creds** (PostHog key, Sentry DSNs, the do-app.yaml secrets) when founder is ready — everything ships dark until then.
- Sentry mobile is JS-errors only; native crash symbolication + source maps = EAS release-build work.
- Carried: pilot D1–D7 rulings (`docs/PILOT_PLAN_2026-07-30.md`), email provider, DECISIONS §J + listener-application ruling, privacy policy, helpline re-verify, Razorpay creds, LLM decision, native perf gate, EAS dev build / SDK 54.

**Next:** founder rules pilot D1–D7; then DO provisioning per DEPLOYMENT.md runbook, or founder phone re-test (now incl. Hindi toggle + the funnel fixes; Expo Go needs the CURRENT LAN IP re-pointed in `apps/mobile/.env`).

**How to resume:** API :8000 + containers RUNNING; **Expo web is DOWN** (its dev-server process ended with the session) — restart with `cd apps/mobile; npx expo start --web --port 8081`. (`apps/mobile/.env` now points at **localhost** — the session-22 LAN IP went stale when DHCP re-leased .12→.10 and every browser API call ERR_ABORTED'd; mento-stack repair table has the row). Listeners seeded (3). E2E: 4 committed suites, reset Redis + capacity before EACH (mento-e2e), `NODE_PATH=C:\Users\khana\.claude\skills\playwright-skill\node_modules` — set it in the SAME shell invocation as `node` (fresh shells drop it). Gotcha: onboarding endpoint is `/api/v1/onboarding/start`, not `/onboarding`.

---

## 2026-07-30 (session 23) — Pilot-transcript review: Module A vs Module B conflicts logged 📋

**Context:** founder shared an AI-generated analysis of a founder–developer call transcript describing a pilot — 50 mentees + 15–20 mentors, 2 sessions/day caps, 24h cooldowns, manual username/password accounts with verification ticks, possible per-session mentor pay. This session assessed it against DECISIONS/PRD/codebase. Verdict: the critique's structure is sound (the transcript has no duration, no success metrics, no decision gate), but the pilot it describes is **Module B** (paid, verified, session-based mentorship) while the repo built **Module A** (anonymous volunteer-listener chat); several of its anchors (a "6-step verification layer", app-store review cycles) don't exist in this repo or don't apply to the Expo stack.

**Done:** assessment (this entry's Open items) + **`docs/PILOT_PLAN_2026-07-30.md`** — repo-grounded pilot plan DRAFT for founder review: pilots Module A as built (real anonymous onboarding, funnel-onboarded listeners, no caps/no pay by default), Week-0 prerequisites all map to existing repo work (H1-remainder Milestones A/B, Stream upsert gap, matcher self-match, `/health/crisis` monitor, helplines, privacy policy), 4-week run + week-5 decision gate with pass/fail numbers, D1–D7 founder rulings table. No code changed.

**Open (founder) — new:**
1. **Pilot scope ruling needed:** the transcript's pilot (verified mentors, session caps, per-session fees) is Module B, which DECISIONS defers until Module A is solid. Rule: does the pilot test the anonymous-listener product as built, or is this a re-scope toward the mentor module? (DECISIONS-level change if the latter.)
2. **Manual credentialed accounts contradict anonymity (DECISIONS §C):** username/password + verification ticks bypass the shipped onboarding, personas, and the <30s promise — the pilot would then never exercise the thing v1 exists to prove.
3. **Session-cap machinery doesn't exist:** 2/day caps, 24h cooldown, time-boxed chats — no "session" concept in the codebase (conversations are open-ended). If ruled in, build as server config (pattern: `services/paths_data.py`), not code constants.
4. **Mentor pay in the pilot touches honest-money (DECISIONS §H):** even token per-session pay is Module B economics; needs an explicit ruling, not a pilot footnote.
5. **"Skip admin approval for mentors" — recommend reject:** conflicts with the session-22 listener-application funnel (shipped, tested, audited). Keep "visible path, locked door".
6. **Store-review fear is moot for a 65-person pilot:** internal-distribution APK / Expo Go + EAS Update (OTA JS pushes, no review). Recommend Android-first via the existing sideload path.
7. **Pilot design gaps to fix before launch:** duration (≥3–4 weeks), pass/fail gates, and instrumentation — any metrics via PostHog must carry the T&S filter (no content/PII; crisis sessions excluded from retention).

**Next:** founder reviews `docs/PILOT_PLAN_2026-07-30.md` and rules D1–D7; if the pilot is a go, Week-0 = execute the H1-remainder PRD (its Milestones A/B are pilot prerequisites) + the two small fixes (Stream upsert, matcher self-match). Otherwise unchanged from session 22 — phone re-test, then dev-build or H1-remainder.

**How to resume:** unchanged from session 22 (see below — stack ports, phone setup, patches warning all still apply).

---

## 2026-07-24 (session 22) — First real-device run (Expo Go, Android) + become-a-listener funnel ships end-to-end ✅

**Context:** founder tested Mento on a physical Android phone for the first time (Expo Go SDK 52, sideloaded APK — Play Store Expo Go is SDK 54). The device run surfaced a stack of native-only crashes invisible to the web test surface, then two real app bugs found by founder testing. Afterward the founder proposed and approved a new v1 feature: an in-app "become a listener" application funnel (spec + plan committed, executed via subagent-driven development — every task passed a spec review AND a code-quality review, with fix rounds applied).

**Done:**
- **Expo Go device compat** (`2bba86a`): three latent native-only crashes fixed — (1) stream-chat's peer auto-install nested a duplicate `react-native-safe-area-context` 5.8 that double-registered `RNCSafeAreaProvider` and killed the root layout → `.npmrc` `legacy-peer-deps` + 4.12.0 override + `react-native-teleport` promoted to an explicit dependency; (2) Stream's `SwipableWrapper` passed gesture-handler 2.20's bare-function Pressable to Reanimated → patched to RN's Pressable (patch covers `src/` — Metro bundles Stream's TS source via the `react-native` entry field — plus both compiled builds); (3) `getEnforcing('StreamVideoThumbnail')` + the shimmer native view + teleport's Fabric portal views don't exist in Expo Go's binary → patched to degrade gracefully (thumbnails no-op, shimmer falls back to core's JS skeleton, portals render inline). All patches persist via `patch-package` (postinstall). Proven against the served Android bundle: no missing TurboModules/native views remain.
- **Landing back-nav fix** (`0be80d1`): founder-found — CTA exit fade + `leaving` Lottie swap outlive the push, so back from onboarding landed on an invisible hero. Reset both on `useFocusEffect`. Proven in-browser (normal + reduced motion, 0 page errors).
- **Start-fresh dialog rebuilt as transparentModal route** (`61f91d5`): founder-found — the app's only RN `<Modal>` presented natively on Android (new arch) but rendered its content blank = invisible full-screen layer, "frozen" app. Now a screens-backed `app/start-fresh.tsx` route; scrim covers the tab bar; backdrop tap cancels. Full flow proven in-browser both motion modes.
- **Become-a-listener funnel** (spec `7af95f8`, plan `600fa9e`, code `f270b76`→`3031d5d`, 12 commits): Profile row → `/listener-apply` form (motivation, community chips, availability, optional email, mentor-interest flag staging Module B, hard-gated "not therapists" pledge) → pending/approved/declined status card (declined is tappable to reapply; approved reveals the private console link in-app) → admin Listeners panel gains an Applications queue (approve creates a real `ListenerProfile` via the existing machinery + audit rows; decline stores an admin-private reason). Backend: `listener_applications` table + migration, member endpoints (one-open constraint via user row-lock, 30-day reapply cooldown, 3/day rate limit, EmailStr validation, suspended listeners never get a console link), admin endpoints (row-locked approve/decline, 200-cap queue). Review hardening rounds: `3f4e0ec`, `640910c`, `fde3fb1`, `6307578`.
- **Chat back-stack fix** (`d06994d`): founder-found on device — hardware back from the first chat dropped onto a stale pre-session landing. Matched moment now rebuilds the stack (dismissAll → replace `/chats` → push chat); landing re-checks the session on focus as defense. Proven in-browser both motion modes + both prior e2e checks re-run green.
- **Verified per mento-verify:** pytest **132 passed** (119 → 132) · `alembic check` clean · listeners re-seeded · `tsc --noEmit` clean · new `e2e/listener-apply.e2e.js` green (normal + reduced-motion, **0 page errors**, admin approve leg driven with a live admin token) · admin panel driven at 1280×800 (approve + decline paths) · final cross-cutting review verdict READY (spec coverage, type consistency, T&S invariants all confirmed: decline reasons never member-visible, personas-only, email rendered nowhere, pledge double-enforced).

**Open (founder) — new:**
- **Email provider decision:** applicant emails are stored, never sent (single `TODO(email-provider)` at the approve call site). Pick a provider to activate console-link emails.
- **DECISIONS.md needs the listener-application ruling** (funnel + Module B staging via `mentor_interest`) — alongside the still-pending §J.
- **Stream upsert gap (pre-existing, now more visible):** neither admin-created nor application-approved listeners are upserted to Stream (only `seed_listeners` does it). Works in dev; in production a fresh listener may not exist Stream-side when their first channel is created. Fix both call sites together.
- **Matcher self-match:** members can now also be listeners; the matcher has no user↔listener exclusion (one-line fix via `listener_applications.listener_id`). Low probability at current roster size.
- **EAS dev build + SDK 54:** Expo Go works via patches, but the durable device-testing path is an EAS development build (needs founder's `npx eas-cli login`); SDK 54 upgrade decision logged 2026-07-24, deferred.
- Carried: phase B direction, gender filter, H1-remainder PRD, privacy policy (+ note: admin application API returns applicant email in JSON even though no UI renders it), helpline re-verify, Razorpay creds, LLM decision, native perf gate.

**Next:** founder re-tests on the phone (walk onboarding → chat → profile → apply; the new funnel included); then dev-build setup or H1-remainder.

**How to resume:** stack RUNNING (API :8000 bound to 0.0.0.0 for the phone, Expo :8081; `apps/mobile/.env` points at LAN IP `192.168.1.12`). Phone setup: Expo Go **2.32.20** (SDK 52) sideloaded from Expo's GitHub releases — don't let Play Store update it; connect via `exp://192.168.1.12:8081`. **Never remove `apps/mobile/.npmrc` or `apps/mobile/patches/`** — they hold the Expo Go compat fixes (reapplied by postinstall). Scratch Playwright for ad-hoc drives: `NODE_PATH=C:/Users/khana/AppData/Local/Temp/claude/pw/node_modules`. Dev DB holds leftover test applications/listeners + two dev admin tokens (ReviewDev, E2E) — revoke via /admin if unwanted.

---

## 2026-07-21 (session 21) — 24-screen UX audit + the polish batch lands: v1 confirmed feature-complete ✅

**Context:** founder asked "what's done, what's missing, make it beautiful — 100M-app bar". Full audit (jcode): stack brought up from cold (Docker Desktop was down), 24 screenshots at 390×844, **0 page errors**. Verdict: **v1 is FEATURE-COMPLETE** (all 15 SCOPE items) — what remains is launch infrastructure (Razorpay creds, PostHog/Sentry/deploy, Hindi core loop, privacy policy, helpline re-verify, native device verification, LLM for Journal Assistant), not features. Audit doc: `docs/UX_REVIEW_2026-07-21.md` (`91df54d`); screenshots out-of-repo at `C:\Users\khana\mento-audit\`.

**Done:**
- **Polish batch** (`0b12f6d`, 10 files): the 2026-07-13 UX-review recommendations #1–#6 + #8 finally implemented, plus this audit's new finds — companion/ready steps tightened so Surprise Me + affirmations cards clear the sticky CTA at 844px; chat header 3→2 lines with the Connected pill → dot (persona name keeps max width); reflection copy reframed as a self-check ("How do you feel right now?") matching the no-ratings promise, energy nodes enlarged; chats search/filters hidden until ≥5 conversations; coffee methods carry a visible "Soon" tag; mood chips gained weather glyphs + soft tint fills (token-based, aurora language); listener console capped at 720px centered on desktop.
- **Verified per mento-verify:** `tsc --noEmit` clean (twice); both committed e2e suites green **0 page errors** (connecting-experience; path-communities incl. the reduced-motion walk); every changed screen re-screenshotted at 390×844; listener console checked at 1280×800; env reset before each run.
- **Deliberate skips (logged):** gender filter (product call, still founder's); listener-chat desktop frame (ops surface, not the reviewed item — follow-up candidate); path home/invite dead space (belongs to the phase-B signature-moments design, not polish).

**Open (founder) — new:**
- **Reflection copy veto:** rewritten to "How do you feel right now? / One quiet check-in before you go — no right answers." per DECISIONS self-reflection framing + UX review #2. 1-line veto reverts.
- **Phase B direction pick (A/B/C question from the audit):** signature-moments design — landing first impression, match-crescendo warmth, companion presence across tabs. Awaiting founder go.
- Carried: gender filter in/out of v1; H1-remainder PRD (PostHog, Sentry/DO deploy, Hindi core loop); privacy policy; helpline re-verify; DECISIONS §J; Razorpay creds; LLM decision; native Android perf gate.

**Next:** founder picks phase B (or closes it); otherwise H1-remainder execution per session 20.

**How to resume:** stack RUNNING (API :8000, Expo web :8081, containers healthy, listeners seeded, env reset). Ops gotcha (recurring): `findstr` silently fails on this repo's LF files on this machine — use `read`/`agentgrep` or node one-liners for code search; psql `-c` quoting breaks in cmd, pipe SQL via stdin (`docker exec -i … psql … < file.sql`); PowerShell needs `-ExecutionPolicy Bypass -File` for local helper scripts.

---

## 2026-07-20 (session 20) — Second architecture-audit round: crisis-scan isolation, atomic rate limits, Stream client lifecycle, prod Dockerfile ✅

**Context:** deep audit (session mouse, 2026-07-19 night) found 18 more findings across backend safety, mobile, and ops. Run as a 3-lane swarm (panda/peacock/penguin under coordinator horse); a jcode reload crashed the coordinator mid-campaign — this session took over, respawned the dead ops lane (parrot), unblocked lane C's missing dependency, and drove all gates green. **pytest 104 → 119.**

**Done:**
- **Lane A backend safety** (`fde10e8`, worker panda): crisis scan now runs under a dedicated `CapacityLimiter` (`CRISIS_SCAN_THREADS`=8) so sync Stream SDK calls can't starve the before-send hook's 5s budget; onboarding commits before the Stream upsert (no DB session held across HTTP); rate limiter is one atomic pipeline INCR+EXPIRE(nx) and self-heals immortal keys; XFF ignored unless `TRUSTED_PROXY_HOPS`>0; PIN guard fails **closed** (503 on Redis outage); webhook replay safety proven via the `stream_message_id` dedupe index (chosen over timestamp rejection — Stream retries can be legitimately old); prod boot refuses empty or reused `ADMIN_JWT_SECRET`; `/health/crisis` hardened (narrow Redis catch, malformed stamp → 503 not 500). 15 new tests (`test_architecture_hardening.py` ×13 + 2).
- **Lane C mobile** (`9f11d26`, worker peacock): promise-deduped `ensureConnected()`/`ensureListenerConnected()` — the 4 racy `client.userID !== id` call sites are gone; web composers clear the draft only after send resolves, failure keeps the draft + calm inline retry line; native crisis-surface failure can't reject an already-sent message; user-realm 401 clears session and routes home behind a one-shot latch; ConnectingStep onboards exactly once (retry re-runs only match); consoles accept `#token=` only (query-string token acceptance removed).
- **ConsolePressable rescue** (`4a7777c`, this session): peacock's commit imported `components/console/ConsolePressable` which was **untracked from an earlier styling session** — HEAD didn't build from a fresh clone. Committed it with the rest of that styling pass (hover/press affordances, `type.titleSmSerif` + `type.stat` tokens, `lib/format.ts` helpers). tsc clean.
- **Lane D ops** (`08ceee6`, worker parrot, respawned from penguin's brief): production `services/api/Dockerfile` (3.12-slim, non-root, HEALTHCHECK, `UVICORN_WORKERS`=2) + `docker-entrypoint.sh` running `alembic upgrade head` before uvicorn (migrations-on-deploy) + `.dockerignore`; conservative `DB_POOL_SIZE=5`/`DB_MAX_OVERFLOW=5` with the max_connections formula documented in `.env.example`; `docs/DEPLOYMENT.md` (build/run, env vars, `/health/crisis` monitor gate, DO PITR backup note, Sentry documented as a known gap). Build proven: image `c9ea53e99844`.
- **Housekeeping** (`34babd8`, `6401e93`): external design/animation skills committed with a CLAUDE.md guardrail (**Mento tokens/motion/Calm register always win over skill defaults; GSAP is DOM-only, never for app screens**); hero image prompts + refs; the H1-remainder executor PRD (`docs/superpowers/plans/2026-07-20-h1-remainder-prd.md`). Also reverted an accidental working-tree wipe of `docs/DECISIONS.md` + PRD updates (restored from HEAD — nothing was lost).

**Verified (this session, on merged HEAD):** pytest **119 passed** · `alembic check` clean · listeners re-seeded · `tsc --noEmit` clean · both e2e suites green, **0 page errors** (path-communities incl. reduced-motion walk; connecting-experience crescendo → chat), env reset before each per mento-e2e · post-suite reset done.

**Open (founder) — new:**
- **Prod upgrade gate:** deployments must set a distinct `ADMIN_JWT_SECRET` before this release boots (new invariant refuses reuse of `JWT_SECRET`).
- Sentry wiring is still a documented gap (DEPLOYMENT.md) — it's Milestone B of the H1-remainder PRD, ready to execute.
- Carried: reflections pseudonymity ratification, reconcile-sweep Stream notification, `/health/crisis` monitor wiring, DECISIONS §J.

**Next:** execute `docs/superpowers/plans/2026-07-20-h1-remainder-prd.md` top-to-bottom — PostHog funnel (dark), Sentry + DO deploy artifacts (Dockerfile from this session feeds it), Hindi core loop + tabs.

**How to resume:** stack RUNNING (API :8000, Expo web :8081, containers healthy, listeners seeded, env reset). Gotcha for the registry: this Windows bash mangles quoted `-m`/`-c` arguments — write commit messages and psql/PowerShell one-liners to temp files (`git commit -F`, `powershell -File`) instead of inline quoting.

**Same session, later — two uncaught web crashes fixed (`298189d`):** user hit "Failed to construct 'ImageData': source width is zero" (dotlottie-react). Root cause: pushing any route while a `LottieTile` was on screen (e.g. chats empty state → Start a Conversation → `/chat/…`) left the DotLottie canvas alive on the hidden tab screen where it collapses to 0×0 and the render loop throws — the exact bug the landing already guards with `leaving`, unguarded in the three LottieTile spots. Fix: `LottieTile` renders the still SceneTile fallback whenever its screen is unfocused (`useIsFocused`). Repro-hunting also exposed a second crash: an unknown stored `companion_animal` (e.g. lowercase `'panda'`) fell through all three art maps and crashed /profile and /path with "reading 'xml'" — `Companion` now degrades unknown values to the Panda brand guide. Both proven by headless repros (0 page errors), tsc clean, both committed e2e suites re-run green.

---

## 2026-07-19 (session 19) — Architecture-audit fixes: capacity accounting, JWT hygiene, prod CORS, Hindi crisis lexicon, crisis alerting ✅

**Context:** external architecture review found 7 problems; founder said fix. Executed as 4 commits (parallel agent lanes + coordinator), each proven by the failing-then-passing test loop. **pytest 54 → 104**, `alembic check` clean, listeners re-seeded.

**Done:**
- **Capacity accounting** (`66dbf49`): `_release_listener` was a Python read-modify-write (lost decrements under concurrency) — now an atomic guarded UPDATE; end/wipe only release the slot on the active→ended/wiped transition (double-end/wipe-after-end no longer double-decrement). New `reconcile_listener_capacity()` ends conversations active past `CONVERSATION_MAX_AGE_HOURS` (default 24) and recomputes every counter from real active rows; exposed as audited **POST /admin/listeners/reconcile**. Tests: `test_capacity_accounting.py` ×3.
- **JWT hygiene** (`daa028e`): admin tokens get their own TTL (`ADMIN_JWT_TTL_DAYS`=14, was silently reusing the listener 30d) and an optional dedicated secret (`ADMIN_JWT_SECRET` — set it in prod so a leaked shared secret can't forge admin). User tokens now carry `role:"user"`; role-less legacy tokens stay valid until 2026-10-17 (drop the `None` branch then). Legacy static-header `/moderation` router **deleted** (superseded by the audited `/admin/moderation` queue).
- **Prod CORS** (`09598c9`): `allow_origins` was `[]` outside dev — the web-only listener/admin consoles could never have worked in prod. Now `CORS_ORIGINS` (comma-separated) with a `console_base_url`-origin fallback + boot invariant (empty list = refuse to boot). `.env.example` documents it.
- **Crisis scan, India-first** (`d6c057d`): all three signals now carry romanized Hinglish + Devanagari patterns ("marna chahta hun", "मरना चाहता हूं", "khudkushi", "mujhe maarte hai"…), pinned by 26 tests incl. false-positive guards ("main **mar**ket ja raha hun" must not trigger). Still the lexical stub by design — contract unchanged for the future model swap.
- **Crisis alerting** (`d6c057d`): new **GET /health/crisis** — 503 when Stream is configured but no webhook stamped in 30 min (or Redis down). The fail-open scan's silent-death detector was pull-only (admin Health tab); point any uptime monitor at this URL and it pages. **Launch gate: wire a monitor.**

**Open (founder) — new:**
- Reflections are **pseudonymous, not anonymous** (`conversation_id` → `users.user_id` is one join). Honest docstring landed; ratify either "acceptable for v1" or drop the conversation key (kills idempotency). Never claim unlinkable in user-facing copy meanwhile.
- Reconcile sweeps stale chats DB-side only — no Stream notification to participants; also admin-triggered only (cron/scheduler later?).
- ~~`routers/listeners.py` static `X-Admin-Token`~~ — **closed same session**: accept/decline now use the audited admin-console JWT auth (+ audit log entries); `admin_token` setting deleted. Static-token auth is fully gone from the API.
- Set `ADMIN_JWT_SECRET` + explicit `CORS_ORIGINS` in prod env. Add `/health/crisis` monitor to PRELAUNCH_CHECKLIST.

**Next:** unchanged H1 horizon — living connecting polish, PostHog funnel, deploy/Sentry, Hindi core loop (crisis lexicon above is the first Hindi piece).

**How to resume:** stack per session 14; pytest truncates listeners — re-seeded already this session. Verify loop: `pytest` (104) + `alembic check` + `tsc --noEmit` (mobile untouched this session).

---

## 2026-07-19 (session 18) — Agent system rebuilt: truthful CLAUDE.md, six ritual skills, permission cleanup — live-drilled green ✅

**Context:** founder mandate — turn the repeated hand-work into a system a cheaper model can run: audit CLAUDE.md against reality, encode the session rituals as skills, clean the permission/plugin surface, then prove it end-to-end.

**Done:**
- **CLAUDE.md truth rewrite** (`01e1c81`, 2026-07-14): audited by 3 parallel explorers; caught session-17 drift (Path/Communities, tabs, Lottie system, permanent mascot ruling, 12/54 test count, layout gaps); added runnable Commands section, universal DoD checklist, gotchas, env vars, "Docs drift to reconcile" section.
- **Six ritual skills** (`2401fdd`, `.claude/skills/`): mento-stack · mento-verify · mento-e2e · mento-session-end · mento-lottie · mento-crisis-webhook, + a CLAUDE.md "Working standards" routing table. GREEN-tested: a zero-context agent given only the skill files produced the correct done-gate sequence, 429 diagnosis, and post-pytest-503 fix.
- **Permission/plugin cleanup** (`f55326c` + local): committed `.claude/settings.json` with 21 read-only allowlist entries (transcript-scan derived); `settings.local.json` pruned 84→16 intentional entries (arbitrary-exec grants removed on founder order); plugins uninstalled: coderabbit, firecrawl, atomic-agents (~21 fewer skills loading per session); playwright-skill SKILL.md fixed (headless default, project-conventions-win).
- **Live drill (this date):** full ritual run by the skills alone — stack up with two repairs (stale :8000 uvicorn AND stale :8081 expo, both predicted by the repair table); **pytest 54 passed**; `alembic check` clean; re-seeded; **tsc clean**; env reset before EACH suite; **both e2e suites green, 0 page errors** (path-communities incl. reduced-motion walk; connecting-experience crescendo → chat). Only mutating commands prompted — the read-only path ran promptless.

**Open (founder) — carried + new:** DECISIONS.md still needs **§J** (communities-as-lens + tab swap); privacy policy launch gate (safety-staff access + community/stage note); helpline re-verify. New from the audit: ruff/black claimed in conventions but not configured/enforced — add to CI or drop the claim; Lottie art not following companion accent needs a ratified yes/no. Backlog unchanged (Stream secret rotation, Razorpay creds, LLM decision, Android perf gate).

**Next:** unchanged H1 horizon — living connecting polish, PostHog funnel, deploy/Sentry, Hindi core loop.

**How to resume:** `claude --continue`; stack is RUNNING (API :8000, Expo web :8081, containers healthy, listeners seeded). The ritual skills route everything — see CLAUDE.md "Working standards"; start any session by invoking **mento-stack**, end it with **mento-session-end**.

---

## 2026-07-13 (session 17) — PATH (COMMUNITIES) SHIPPED: Pathfinder → community lens end-to-end ✅

**Context:** founder ruling — Mento is the safe-place ENGINE; UPSC is the first *community*, NEET/JEE/exams/life next. Ship a Path tab where companion-led questions (the Pathfinder) place the user on a path that tunes matching, prompts, and seasonal support. A community is a LENS, never a feed (anonymity rails untouched). Tab option B: Path absorbs Mentors. Also this session: full Wispr Flow transcript archive exported + distilled (`C:\Users\khana\mento-transcripts\`, PRIVATE, outside git — 05-EXPERIENCE-BLUEPRINT.md maps every founder idea → product) — the Pathfinder/warm-up-prompt features come straight from it.

**Done (2 commits, spec `docs/superpowers/specs/2026-07-13-path-communities.md`):**
- **Backend** (`feat(api)`): `paths_data.py` — 5 communities (upsc/neet/jee/exams/life) with gently-named journey stages, warm-up prompts (founder May ruling: "they won't know how to ask — give them sample questions"), and emotional-calendar seasonal cards (month-day ranges). `GET /paths/tree`, `GET/PUT/DELETE /paths/me`. `users.community_slug+journey_stage`, `listener_profiles.community_slug` (migration `823180809488`). Matcher: community = strongest SOFT preference (community+category > community > category > rest) — never strands a user. Seeds: one upsc, one neet, one all-paths listener. **pytest 54 passed** (6 new: tree integrity, choose/clear, validation, matcher preference + never-strand). Gotcha logged: with `from __future__ import annotations`, FastAPI 0.115 stringifies `-> None` and trips the 204-bodyless assert — drop the return annotation on 204 routes.
- **Frontend** (`feat(mobile)`): Path tab (Chats · Path · Journals · Profile; mentors hidden-but-routable via Browse; tab bar focus lookup now name-based). Pathfinder walks the server tree blindly (adding a community = config). Path home: stage card + seasonal card + tappable prompts + listeners-online + Talk now/Browse + change-path. Prompt tap seeds the chat composer via `?starter=` — **never auto-sent** (web `initialDraft`; native `useMessageComposer().textComposer.setText`). tsc clean.
- **Proven:** `apps/mobile/e2e/path-communities.e2e.js` (**E2E scripts now live IN the repo** — new `e2e/` convention): onboard → pathfinder → UPSC/prelims_wait home → prompt pre-fills composer unsent → re-path to Life → reduced-motion walk. **0 page errors.**

**Open (founder):** Path tab icon/name (trail-sign / "Path" — 1-line veto); DECISIONS needs a §J entry for communities-as-lens + tab swap (docs deliberately not updated this session per founder "don't follow the docs" — reconcile before it drifts); privacy policy gains nothing (community+stage are coarse, self-declared, clearable). Carried backlog unchanged.

**Next (agreed horizons):** H1 remainder — living connecting experience (companion searching + breathe-with-me + match crescendo, spec'd in session), PostHog funnel, deploy/Sentry, Hindi core loop. Then H2 Module B in the post-mains window.

**How to resume:** stack per session 14; API restarted this session (remember: re-seed after pytest truncates). E2E: `NODE_PATH=<playwright-skill node_modules> node apps/mobile/e2e/path-communities.e2e.js`.

**Same session, part 7 — free-Lottie art system (founder: "grab as many as we can"):** `scripts/theme_lottie.py` is now the repo's asset pipeline — any free Lottie in, Mento-themed out (static + animated + gradient colors by HSL role; embeds .lottie zip rasters as data URIs). Hauled 6 candidates from LottieFiles free tier (bot-blocked → headless-browser network capture; per-page asset URLs live in the rendered DOM, the shared hero asset is a decoy). Contact-sheet review: **kept 4** — chat typing dots (chats empty), notebook writing (journals AI card), piggy bank w/ gold coin (finance journal empty), breathing blob (registered, unwired); **rejected 2** — coffee-cup (outline goes invisible on cream), no-data (raster, unthemable). New `LottieTile` renders any of these in the SceneTile slot with the reduced-motion still fallback. Licence table in `assets/lottie/README.md`. Proven: journals + finance screenshots (0 page errors), path E2E green, tsc clean.

**Same session, part 6 — landing hero is a live Lottie (founder-supplied asset):** founder's `Study discussion.json` (LottieFiles free tier, Lottie Simple License) recolored by script — all 138 static color props remapped (#FF700F→accent, blacks→ink family, white kept) → `assets/lottie/study-discussion.json` (+README with the remap table). Renders in the landing's depth-0.55 plane (autoPlay/loop); reduced motion gets the still SVG scene. **Two web gotchas for the registry:** (1) `LottieView` on web ignores `style` — size via `webStyle` inside a sized wrapper View; (2) DotLottie throws `ImageData width 0` if its canvas survives route teardown — a `leaving` state swaps the still scene in when the CTA exit starts. Connecting E2E green, tsc clean, visually verified (indigo figures, ink outlines — reads native to the theme).

**Same session, part 5 — the landing goes 3D + TiltCard everywhere (founder: "everything 3D, landing feels minimal, go"):** `Tilt3D` upgraded from tilt-only to a **parallax depth engine** — `depth` prop shifts each layer up to ±16px with the pointer (negative = background moves against it), so sibling planes separate into an actual scene. Landing depth stack (back→front): mountains (−0.5) → three ambient accent-tint orbs (−0.25/0.35/0.7 — volume between sky and content) → hero scene (0.55, + a grounding shadow ellipse so it stands on something) → CTA (0.45) → subline (0.2) → logo (0.9, closest, rides the most). New `TiltCard` (motion/): pressable cards tilt toward the **exact touch point** (press a corner, that corner dips; spring.calm settle) — applied to pathfinder options + Path-home prompt cards; the dimensional counterpart of PrimaryButton's press physics. Reduced motion collapses everything flat. Proven: both E2E suites green (0 page errors), tsc clean, landing composition visually verified at 390×844 (screenshot in scratchpad). Also this part: **web tools confirmed live** (pi-web-access) — first hunt found `diffusionstudio/lottie` (MIT, ★3.6k: agent-generated production Lottie — candidate for generating our own consistent 6-animal set for ₹0) and LottieFiles Simple License free singles (fox/owl/panda, style-inconsistent). **Next-session candidate: PoC one companion animation via diffusionstudio/lottie.**

**Same session, part 4 — Rive retired + rig grows + pi tooling (founder: no commission budget, "go"):** DECISIONS §I.4 gains the retirement note — **in-house rig + generated art + 2.5D is the permanent v1 character route** (traced via git: the commission line was the 2026-07-11 founder call, amended same day, never a dependency). Rig gains three states (`ReactiveCompanion` + `character` tokens): **curious** (head-tilt + rise — fires on the email step), **joy** (decaying wiggle, lighter than celebrate — fires when a path is chosen), **sleepy idle** (22:00–06:00 local: softer/slower sway + held droop on a dedicated shared value so triggered states can't erase night posture; checked once per mount). Tooling: **pi-web-access installed** (source-reviewed: child_process only in git-clone/video paths, MIT) — web search/fetch tools available from next session for free-asset hunts; a fresh GitHub sweep re-confirmed session-12's finding (no consistent free 6-animal set). Proven: both E2E suites green after env reset; tsc clean. **E2E flake root-caused:** sequential suite runs exhaust listener capacity mid-run — always reset Redis + `active_conversations` immediately before each suite, not once per session.

**Same session, part 3 — 2.5D depth system (founder: "3D journey, not static images"):** honest call recorded — no 3D engine (binary + 60fps mid-Android + calm register; the Calm/Headspace "3D feel" is 2.5D), founder's intent delivered via dimensionality: new `Tilt3D` (perspective+rotateX/rotateY; web = faces the pointer via direct shared-value writes with zero re-renders, native = slow two-desynced-period drift, reduced motion = flat and still) applied to the PandaStage companion (±6°), landing logo (±5°) + hero scene (±3° — separated planes), and Path-tab companions; `PrimaryButton` gained dimensional press physics (sink + top-edge tilt + spring.calm settle-back — an object, not a decal; API unchanged). Proven: both E2E suites re-run green, 0 page errors; tsc clean. **Ops gotchas logged:** E2E runs exhaust the onboarding rate limit (10/h/IP → 429) and listener capacity (3×3 slots) — between runs: `docker exec mento-redis redis-cli FLUSHDB` + reset `active_conversations`. The busy→retry→honest-error path was accidentally live-proven by the capacity exhaustion.

**Same session, part 2 — the living connecting experience (founder: "go with everything"):** the wait for a match is now a story, not a spinner. `ConnectionConstellation` (new, `components/motion/`): member orb (accent) + listener orb (warm gold), a luminous thread that creeps-but-never-completes while searching, alternating orb pulses (exactly one mover at a time), found = orbs meet + bloom + heart, error = freeze-and-dim (stillness signals the problem). `ConnectingStep` rewritten: staged searching copy (3 rotating lines, crossfaded), the 5 guidelines + 3 conversation warm-ups now a breathing card carousel with dots (reduced motion = full static list), **breathe-with-me** after 6s of real waiting (guide text flips at `breathe.period/2`; the constellation ring shares the token so they can't drift), **honest busy phase** (503 → 3 quiet retries at 8s with "holding your place" copy — busy is not broken; then a real error state), minimum story beat (2.2s) so instant matches never cut mid-breath — skipped under reduced motion (their time wins over our theatre), and the **found crescendo**: "[Persona] is here for you" card lands, then the journey's existing celebrate beat (haptic + hop + sky lift) carries into chat. Proven: `e2e/connecting-experience.e2e.js` (story → crescendo card → chat) + path E2E re-run (incl. reduced-motion onboarding through the new step), 0 page errors both; tsc clean. Busy-phase retries are logic-tested by design review only — forcing 503 needs all listeners suspended; add an admin-assisted E2E later.

---

## 2026-07-13 (session 16) — Admin dashboard built end-to-end + dev listener picker ✅

**Context:** founder: "go" on the admin dashboard (designed session 15). Also, before that, killed the listener-console token-link hassle for dev.

**Done:**
- **Dev listener picker** (`feat: dev-only listener picker`): opening `/listener` with no token in DEV now shows a click-to-enter roster (`/listener/dev/roster` + `/dev/token/{id}`, both 404 in prod — proven); session persists on refresh. Real token-link auth untouched. pytest +2.
- **Admin dashboard — SHIPPED** (spec→plan→build, `docs/superpowers/plans/2026-07-13-admin-dashboard.md`). Backend (`routers/admin_console.py`, `models/admin.py`, `services/audit.py`, migration `911d842dce97`): admin JWT + `current_admin` (per-request revocation), audit writer, and all 7 sections — overview cockpit counts (crisis excluded), safety flags + **audited read-only live conversation view** (`stream.fetch_channel_messages`, never stored), moderation queue + resolve + one-click listener suspend/reinstate, listener CRUD + console-link issuing, health deep-check + **last-webhook stamp** (silent-death detector), contributions stub, owner-only admin create/revoke + audit log. Bootstrap `scripts/issue_admin_token.py`. **48 pytest passed** (13 new admin). Frontend (`app/admin/`, `components/admin/AdminConsole.web.tsx` + `panels/` ×7, `lib/adminApi.ts` + `adminSession.ts`): web-only cockpit, token-link auth mirroring the listener console, top tabs + unreviewed badges, Admins tab owner-only. tsc clean; **owner E2E walk green** (`C:/tmp/playwright-admin.js`), 0 page errors; verified in-browser (cockpit counts, live safety flag, working audit log).

**Open (founder) — carried + NEW:** **privacy policy must disclose that trained safety staff can view conversations for crisis review** (hard launch gate — the admin live-view makes this real). Retire legacy static `x-admin-token` moderation/listeners endpoints eventually (left in place — DECISIONS §I.6 sanctioned them for ops, still tested, frontend doesn't use them). Rest of backlog unchanged (Stream secret rotation, Razorpay, LLM decision, helpline re-verify, Higgsfield licence, Rive commission, Android perf gate).

**How to resume:** `cd C:\Users\khana\mento` → `claude --continue`. Admin bootstrap: `cd services/api && .venv\Scripts\python.exe -m scripts.issue_admin_token --owner --name "Founder"` → open the printed `/admin#token=` link. Dev listener console: just open `/listener` and pick. Stack start unchanged (session 14).

---

## 2026-07-13 (session 15) — Options bug closed, landing refreshed, admin dashboard designed ✅

**Context:** founder reported "End conversation didn't work"; wanted the landing enhanced modestly (logo + polish, theme intact); and the admin dashboard scoped fully. Brainstormed both new features (visual companion used) → specs → landing implemented.

**Done:**
- **"End conversation" bug — root-caused & fixed.** End itself is healthy (verified click-through: API 200, DB `status=ended`, reflection opens). The real fault: with the session wiped in another tab, the chat screen stranded the user on raw 403s for *every* option. The tabs-only session guard is now a shared hook (`lib/useSessionGuard`) covering tabs + both ChatScreen variants + reflection. (`fix(mobile): session-loss guard covers chat + reflection`.)
- **Landing refresh (spec + plan + shipped, 4 commits).** New **bubble-heart logo** (`components/art/Logo.tsx`, indigo→lavender gradient, serif wordmark; per-instance `useId` gradient id — duplicate ids broke `url(#)` on web, caught in visual check). Polish: serif display headline, larger balanced logo, static accent glow on the CTA, and **SkyMotes** (`components/motion/SkyMotes.tsx`) — three sequenced light motes, only one moving at a time to respect the ≤3-mover budget. Reduced-motion = motes absent, page byte-identical over 2s, CTA still navigates. Full journey-to-chat E2E green. Specs/plan in `docs/superpowers/`.
- **Admin dashboard — designed & spec'd** (`docs/superpowers/specs/2026-07-13-admin-dashboard-design.md`), brainstorm-approved, NOT yet built. Seven sections (safety review with live read-only conversation view · moderation + one-click suspend · listener management replacing CLI scripts · cockpit overview · system health incl. silent-webhook-death detector · contributions stub · admins + full audit trail). Owner/helper token-link auth (listener-console pattern), `/admin` web-only in Expo. **Next build target.**

**Open (founder):** approve admin spec to build; landing logo lives — veto reversible in one file. Carried backlog unchanged (Stream secret rotation, Razorpay, LLM decision, helpline re-verify, Higgsfield licence). New to-do surfaced by admin design: **privacy policy must disclose safety-staff conversation access** before launch.

**How to resume:** `cd C:\Users\khana\mento` → `claude --continue`. Stack unchanged (see session 14). Landing spec/plan under `docs/superpowers/`; admin spec ready to hand to writing-plans.

---

## 2026-07-13 (session 14) — Full audit sweep: security hardened, scaled for 500 concurrent, E2E-proven ✅

**Context:** founder mandate — verify requirement alignment, find & fix security loopholes, refactor for 500 concurrent users (dev/UAT) without breaking function, test everything E2E with Playwright, UI/UX review against the international bar, refresh docs. Three parallel audit agents (security / performance / PRD-alignment) + fixes, each unit proven.

**Done (4 commits):**
- **Security** (`feat(api)` commit): startup invariants (no boot in non-dev with default JWT secret or missing Stream creds); **rate limiting is now real** (`app/ratelimit.py`, Redis fixed-window, fail-open-never-silent: onboarding 10/h per IP, match 10/10min per user, PIN 5/15min); `/safety/scan` ownership check (no flag planting); SafetyFlags store the **signal only**, never message fragments (T&S #6 now true in code); constant-time admin-token compare; UTC age gate; input caps; **listener console links use `#token=` fragments** (never in server logs).
- **Performance** (same commit): webhook hot path off the event loop (`run_in_threadpool`, one session/event); matcher restructured — unlocked preview, lock ONLY the chosen row, **Stream call moved outside the transaction** (with atomic compensation) so row locks last µs and concurrent matchers can't 503 spuriously; cached Stream client + 3s timeout; env-tunable DB pool (20+20, 5s fail-fast); migration `c7a91f4d2b58` (unique `conversations.stream_channel_id` — the per-message webhook lookup was a seq scan; unique `safety_flags.stream_message_id`; composite block-list index); SQL-side mentor-note dedupe; pagination; gzip.
- **Frontend batch** (`fix(mobile)` commits): **reflection fully decoupled from payments** (the `energy≥4 → /coffee` auto-route violated DECISIONS §A.3 — the clearest spec violation found); session-loss guard (tabs → landing instead of endless 403s — witnessed live); api timeout (10s); chats Stream query capped at 30; web chat memoized (keystrokes no longer re-render the transcript) + **typing indicators both directions** incl. the listener console; aurora pauses when unfocused (two shaders were painting simultaneously); **Panda Mask surfaced** (masked member shows "Away right now" listener-side); topic chips humanized (`self_esteem` → "Self-esteem"); console consumes re-pasted `#token=` links (hashchange + Retry).
- **Proven:** pytest **35 passed** (7 new security tests: age gate ×3, wipe ownership+hard-delete, scan ownership, signal-only flags, PIN lockout); `alembic check` clean; tsc clean; **full member+listener+personal-request E2E green** (`C:/tmp/playwright-test-console.js` — onboard→match→chat→console token link→live reply→request accept→away toggle→bad token, 0 page errors) — run before AND after every change wave.
- **UI/UX review** (`docs/UX_REVIEW_2026-07-13.md`): verdict — core loop meets the international bar; 8 founder-review recommendations (top: chat-header persona truncation; reflection copy says "rate this conversation" which contradicts the no-ratings promise; gender filter PRD gap = product call). Screenshots in session scratchpad.

**Open decisions (founder):** the 8 UX recommendations above; gender filter in/out of v1; carried — Higgsfield licence check, LLM for Journal Assistant, Razorpay creds, **Stream secret rotation** + stable webhook URL, Rive commission, re-verify helplines. Engineering watchlist: prod deploy runbook (multi-worker + proxy gzip), PostHog wiring, crisis-flag review surface, journals offline cache, Android release perf gate + Maestro.

**How to resume:** `cd C:\Users\khana\mento` then `claude --continue` (or `claude -r` to pick a session). Stack: Docker Desktop → `services/api`: `docker compose up -d` → `.venv\Scripts\python.exe -m alembic upgrade head` → `-m scripts.seed_listeners` → `-m uvicorn app.main:app --port 8000`; `apps/mobile`: `npx expo start --web --port 8081`. E2E: `NODE_PATH=<playwright-skill node_modules> node C:/tmp/playwright-test-console.js`. **Trap reminder:** pytest truncates dev listeners (re-seed after) and old listener tokens die with re-seeded listener ids (issue a fresh one).

---

## 2026-07-12 (session 13) — AI-generated companion set shipped as the default art ✅

**Context:** founder added Higgsfield credits (free plan, 40) and approved generating companion art with them, then ruled: put the generated set in the app. The in-house rig stays the animation layer; only the art inside it changed.

**Done:**
- **Candidate set generated** (12 credits, Google Nano Banana 2 via Higgsfield MCP): panda first as the style lock (prompt from `docs/MASCOT_COMMISSION_BRIEF.md`), then the other five with the panda as image reference → one consistent soft-shaded, cute-but-dignified style (indigo scarf accent, natural animal colours). Owl took 3 attempts (wide eyes = alert, half-lidded = bored; v3 = "eyes like the panda's + gentle smile"). Full-res originals + job IDs: `docs/mascot-candidates/` (README documents licence caveat + regeneration).
- **Shipped into the app**: background-removed via Higgsfield (6 credits), trimmed + resized to 512px lossy WebP with sharp → `apps/mobile/assets/companions/generated/` (~26KB each, ~162KB total — lighter than the Fluent SVGs). `Companion.tsx` priority chain is now **Lottie override → generated cutout → Fluent fallback**; rendered with RN `Image` (webp in Metro's default assetExts; `expo-env.d.ts` types the require). All ReactiveCompanion states/reduced-motion behaviour untouched (art swap only — no new animation).
- **Proven (Playwright, Expo web 390×844, 0 console errors):** landing → age → skip email → companion picker shows the generated art on all six cards; picking fox swaps the PandaStage companion + teal accent washes the sky (companion-is-the-star intact); ready arch renders the fox at 120px; turtle/deer/owl each verified on card + stage. `tsc --noEmit` clean. Deep-link guard re-confirmed (fresh load + `?step=companion` snaps to age).
- **Higgsfield facts for future sessions:** Recraft V4.1 is plan-gated (`job_minimum_basic_plan_required` even with credits); unfiltered `models_explore action:list` 500s — query per `type`. ~22 credits remain.

**Same session, part 2 — panda pose set (founder: "use the remaining credits to make the app beautiful"):** the six coded-SVG panda poses (wave/sleep/excited/coffee/sad/shield — used across reflection, coffee, all conversation-control overlays, profile Start-fresh, mentor profiles = 12 screens) now render style-matched generated art (same panda, style-locked via image reference; 15 credits incl. cutouts). `Panda.tsx` checks `assets/companions/generated/panda-poses/` first, coded SVG stays as fallback. Full-res originals + job IDs in `docs/mascot-candidates/poses/`. Proven: `/reflection` (wave header + sleep/excited slider endpoints) and `/coffee` (coffee hero + excited card + shield footer) on Expo web, 0 console errors, tsc clean. Trade-off logged: raster poses wear fixed indigo scarf (SVG cape used to re-tint to the accent) — consistent with the companion set. Free-plan gotcha: max 4 concurrent Higgsfield jobs. ~7 credits remain.

**Same session, part 3 — empty-state scenes (final 6 credits):** four spot illustrations (no character, theme-invariant, warm-cream bg kept) now give each empty-state moment its own art via the new `SceneTile` rounded-tile component (`assets/scenes/`, ~23KB): My Chats "No conversations yet" (two cushions + plant), chat "You're connected!" (two bubbles + heart), Journals-hub AI card (journal + chat bubble), and all four journal channels (open journal + sprout — first art these ever had). The shared coded `ChatBubblesScene` is fully replaced at its three call sites (component retained in Scenes.tsx, now unused). Proven: `/journal/mood`, `/journals`, `/chats` on Expo web (only console error = backend-offline fetch, by design); tsc clean. **1 credit remains.**

**Open decisions:** verify Higgsfield's commercial-use terms for the free plan before store submission (noted in `docs/mascot-candidates/README.md`). Rive commission unchanged — these cutouts are the style-lock package to send with the brief. LLM for the Journal Assistant still open (carried).

**Next:** carried backlog unchanged — release-build Android perf gate + Maestro (device), Stream secret rotation + stable webhook URL (founder), Razorpay creds, AI Journal Assistant (LLM decision).

**How to resume:** mobile `npx expo start --web --port 8081` (running at end of session); backend not needed for the art path. Verification screenshots in the session scratchpad.

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
