# Board port — lanes, state and how to resume (written 2026-09-19)

**Read this first if you are a new session (any model) picking this work up.** The founder's acceptance test, verbatim: *"I want the app to look what exactly is on the board. I don't need any excuse. Look, feel, transitions — everything should come out as it is."* The board's artboard sources are in `docs/design-board/` (live board: https://claude.ai/artifact/SWQyjqF1e5nBwDuCWZcjyr). The contract every port agent works to is `docs/superpowers/plans/2026-09-19-board-port-brief.md`.

## What is already shipped (master `aa87660` + docs commits, prod live)
Unified Journal hub, chat header card + "In this chat" strip, first-question builder, nine companions (Cat has hang/peek/dangle), professional copy, transition fixes (tabs slide, no flashes, no spinner on return, oat first paint), the companion finds a new spot on every screen, backend hardening (audit `docs/BACKEND_AUDIT_2026-09-19.md`), unified domains + desktop web frame. Prod API `ee9b5ca`, web from `aa87660`, OTA `01a0b94a` (preview channel). See the top entry of `PROGRESS.md`.

## Parallel lanes (so agents never share a dev server, a database or a working tree)
`scripts/lanes/lane.ps1 -Name <n> -N <k> -Base <branch>` creates: worktree `C:\ml\<n>`, branch `feat/port-<n>`, database `mento_<n>` (migrated + 3 seeded mentors), Redis index `1+k`, API `:8000+k`, Expo web `:8081+k` (detached processes; logs `api.err.log`, `expo.log` in the worktree). Every e2e spec reads `MENTO_WEB`, `MENTO_API`, `MENTO_DB`, `MENTO_REDIS_DB` (defaults = the main checkout). If a machine restart kills a lane's servers, re-run the same command: it skips what exists and restarts the servers. Start the detached setup WITHOUT piping its output (piping hangs on the children's inherited handles):
`Start-Process -WindowStyle Hidden pwsh -ArgumentList "-NoProfile","-File","scripts\lanes\lane.ps1","-Name","u2","-N","2" -RedirectStandardOutput C:\ml\u2-setup.log`

| Lane | Where | Branch | Web / API / DB / Redis | Unit (board row) | Screens |
|---|---|---|---|---|---|
| main | repo checkout | `feat/board-port` | 8081 / 8000 / `mento` / 0 | First run (row 1) + server features | DONE: A01 landing, A02 role fork (film via expo-video), A16 age wheels, A17 email, A03 companion pick, A18 Ready, A19 connecting → found, hand-overs T01/T02. API DONE: message allowance, rotating names + stay in touch (cap 2), feedback — 3 additive migrations, wiring doc `docs/superpowers/specs/2026-09-19-board-port-api.md`. |
| u2 | `C:\ml\u2` | `feat/port-u2` | 8083 / 8002 / `mento_u2` / 3 | Inside a conversation (row 2) | A05 live thread (bubbles, save chip, composer, allowance pips) · A22 three-in-a-row note · A21 crisis card · A20 options sheet (two End choices, no money row) · A23 Reflection · A11 Feedback sheet · A39 Not found · new `e2e/conversation-port.e2e.js` |
| u3 | `C:\ml\u3` | `feat/port-u3` | 8084 / 8003 / `mento_u3` / 4 | The four tabs (row 3) | A06 My Chats + In touch view + badge · A24 New chat sheet (topic → `issue_category`) · A25 Browse · A14 mentor profile + stay-in-touch ask · A07 Path home · A26 Pathfinder · A27 builder pass · A28 Write · A29 past day · A30 Find the threads · A09 Profile · A31 Support · A32 Start fresh (COPY MUST BE TRUE — audit F24: nothing is erased server-side today) · new `e2e/tabs-port.e2e.js` |
| u4 | `C:\ml\u4` | `feat/port-u4` | 8085 / 8004 / `mento_u4` / 5 | The mentor side (row 4) | A33 primer · A34 hand-off · A37 application + status · A38 public apply (no animals; age gate kept) · A10 Mentor Home (+ stay-in-touch asks, snooze only if the API has it) · A15 decision sheet · A35 mentor chat (Helplines, no allowance meter) · A36 member brief · new `e2e/mentor-port.e2e.js` |

Each agent commits ONE SCREEN PER COMMIT, proven (tsc + the specs that touch it, normal + reduced motion, 0 page errors) — so whatever stops an agent, finished screens are in git. To see where a lane is: `git -C C:\ml\u2 log --oneline feat/board-port..HEAD`. To continue a lane with a new agent: give it the brief file, the lane row above, and "continue from the last commit; re-read your own diff first".

## Not owned by any lane yet (assign after the lanes land)
1. **A04 Request sent — the letter** (the reply-when-free path; "Send your question instead" currently leads to Browse).
2. **The onboarding companion must GLIDE between perches as one element** (board T02); the first-run port fades it. Transform/opacity only; one overlay above the steps.
3. **T05 row → chat and T06 sheets/deeper pages as shared-element hand-overs** (avatar flies from the My Chats row / header slot) — needs the origin store described on board sheet T90 (`docs/design-board/T90_TransitionSystem.dc.html`).
4. **Living companion loops on native** (`expo.webp.animated=true` build flag, `docs/ANDROID_BUILD.md` §6b) and art for the other eight animals (Higgsfield has ~0.5 credits and no free tier via the API — founder decision).
5. **A12 Mentor Reading 1** is private (partner's words) — NOT in the repo; the Mentor Home row needs a route and the founder's decision on where that text lives.
6. **A13 admin allowance counts** panel in the admin dashboard (API exists: `GET /admin/allowance`), and an admin feedback list (`GET /admin/feedback`).
7. Safety tip "Don't share personal information" no longer appears before the first chat (the board shows two cards, the old screen rotated eight) — founder decides where it lives.

## Merge and ship, one unit at a time (never two lanes at once)
1. In the main checkout: `git checkout master && git merge --no-ff <branch>`. Expect conflicts in `apps/mobile/locales/{en,hi}.json`, `theme/tokens.ts`, `theme/motion.ts`, `lib/api.ts`, `app/_layout.tsx` — lanes were told to make additive, localized edits; take BOTH sides, keep JSON valid, then check EN/HI key parity.
2. Gates on the merged tree: pytest against the isolated DB (`DATABASE_URL=postgresql+psycopg://mento:mento@localhost:5432/mento_wt REDIS_URL=redis://localhost:6379/1 .\.venv\Scripts\python.exe -m pytest`) · `alembic check` · ruff · black · `npx tsc --noEmit` · `./deploy/test-nginx.sh` · `bash scripts/lanes/e2e_gate.sh` (every spec, seats reset + Redis flushed before each; needs the main dev API :8000 restarted on the merged code and Expo :8081 running WITHOUT `CI=1`).
3. `git push origin master` (only `api-ci` runs; the console-deploy workflow fails loudly on missing secrets — expected).
4. API (only when `services/api` changed): `ssh mento-ops@87.232.72.79 'cd /opt/mento && ./deploy/backup-postgres.sh && ./deploy/deploy.sh'` — the backup is mandatory when there are migrations (the board-port API has three). Then check `https://api.agentin.chat/api/v1/health` and `/health/ready`. Keep `ALLOWANCE_ENFORCED=false` on prod until the A22 note is live in the app; tell mentors before the first 04:00 IST name rotation. `/health/crisis` has been 503 "stale" since 2026-09-10 (needs one real message on prod — founder's call; never run `configure_stream` with a non-prod URL).
5. Web: `env -u EXPO_PUBLIC_API_URL -u CI ./deploy/deploy-web.sh` from the repo root (needs `apps/mobile/.env.production`).
6. Phone: from `apps/mobile`, with `EXPO_PUBLIC_API_URL` and `CI` unset and `NODE_ENV=production`: `npx eas-cli update --branch preview --message "<what changed>" --non-interactive`. A new APK is only needed for native/app.json changes — procedure and gotchas in `docs/ANDROID_BUILD.md` §8j (run the three steps under PowerShell 7 with `SENTRY_DISABLE_AUTO_UPLOAD=true`, from the short path `C:\mento-build\mobile`).
7. Write the unit into `PROGRESS.md` (top entry), commit, push.

Production SSH and deploys were approved by the founder on 2026-09-19 for this work; a new session should confirm before its first production action.

## After lanes u6–u8 land (founder, 2026-09-19): re-arrange the design board to match the app
"Once everything is done, rearrange the board how it is wired right now, and what's left to build or navigate."
1. Capture every screen of the SHIPPED app (web build, 390×844) with a Playwright walker in the style of the session-35 app-map capture (`scratchpad/appmap/capture.js` — recreate it if the scratchpad is gone): member first run, the unified mentor path (each state), inside a conversation, the four tabs and what is behind them, the mentor side, sheets.
2. Re-lay the board (https://claude.ai/artifact/SWQyjqF1e5nBwDuCWZcjyr) in the ACTUAL navigation order, one row per flow, each app screenshot beside its board artboard, with arrows/labels for how you get from one to the next (the real routes, incl. the unified mentor loop and "I'd rather talk today").
3. A clear "Left to build or wire" row: board artboards with no app screen yet, screens that differ from the board (from each lane's "differs" list), dead ends or doors that lead nowhere, and open founder decisions — each as a card.
Publish rules: read the live index first, change only our keys, batch the publish (see memory note `final-design-board`).

## Round 3 (2026-09-19, founder: "go") — the "Left to build or wire" row, in three lanes off master `15dfa5d`
| Lane | Web / API / DB / Redis | Owns |
|---|---|---|
| u10 | 8091 / 8010 / `mento_u10` / 11 | New chat busy exits, one-open-question rule (server + app), composer grows (no clipped starter), the pre-ask mentor page + compose step to the board, empty-thread art, "Save to Journal" copy. No migration. |
| u11 | 8092 / 8011 / `mento_u11` / 12 | One face per mentor everywhere (`listener_profiles.companion_animal`, the ONLY migration, off `3a56447b2ab6`), member companions on Mentor Home rows, topic label, "Your line" sheet, the mentor chat Owl, application copy. |
| u12 | 8093 / 8012 / `mento_u12` / 13 | Companion pick copy + clipping, Profile "Support the team" row, My Chats empty state, admin A13 allowance panel + admin feedback list. No migration. |
Parked by the founder: companion glide (T02), row→chat / sheet shared elements (T05/T06), living art (credits). Gotcha learned: stopping a background gate with TaskStop does NOT kill `e2e_gate.sh` on Windows — two gates then reset the same DB under each other. Kill with `Get-CimInstance Win32_Process | ? CommandLine -match 'e2e_gate\.sh|\.e2e\.js' | % { Stop-Process $_.ProcessId -Force }` before starting another.
