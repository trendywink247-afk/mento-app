---
name: mento-e2e
description: Use when proving a user-facing Mento flow in the browser, writing or running e2e scripts, or when e2e runs hit 429s, 503s, or flake between runs.
---

# Mento E2E — write & run browser proofs

**H: workspace override (2026-10-02):** use `MENTO_WEB=http://localhost:18081`
and `MENTO_API=http://localhost:18000/api/v1`. Only reset the project from
`deploy/compose.workspace.yml` (Valkey :16379, Postgres :15432); never run the
legacy `docker exec mento-redis/mento-postgres` commands below. Read
`docs/ENVIRONMENTS.md` before selecting specs: some still hard-code those names.
`two-party-chat.e2e.js` accepts `MENTO_REDUCED_MOTION=1` for its second pass.

Prereq: stack running per **mento-stack** (API :8000 seeded, Expo web :8081).

## Reset the environment BEFORE EVERY suite run — not once per session

Sequential runs exhaust the onboarding rate limit (10/h/IP → 429) and listener capacity (3×3 slots → 503). Root-caused session 17; skipping this is the #1 flake source.

```powershell
docker exec mento-redis redis-cli FLUSHDB
docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET active_conversations = 0;"
```

## Run

Playwright is **not** a project dependency. It lives in the playwright-skill install:

```powershell
cd apps/mobile
$env:NODE_PATH = "C:\Users\khana\.claude\skills\playwright-skill\node_modules"
node e2e\path-communities.e2e.js
```

## Conventions (every script)

- Plain Node script in `apps/mobile/e2e/*.e2e.js` — **not** `@playwright/test`. Copy an existing script as the template.
- `chromium.launch({ headless: true })`, viewport **390×844**, `WEB = 'http://localhost:8081'`.
- Collect `page.on('pageerror')` and **fail on any** — 0 page errors is the bar.
- Every flow gets a second pass in a `reducedMotion: 'reduce'` context: must stay static AND complete.
- New user-facing flow ⇒ new committed `.e2e.js`; changed existing flow ⇒ re-run (and extend if behavior changed) its existing script. One-off probes go to the scratchpad, never `e2e/`.

## Common mistakes

| Mistake | Consequence |
|---|---|
| Skipping the reset between suites | 429/503 mid-run that looks like an app bug |
| `headless: false` (playwright-skill's default) | Repo scripts are headless; visible browsers are for one-off debugging only |
| Testing only the happy path | The DoD wants error/empty states too — freeze-and-dim is designed behavior, assert it |
| Writing throwaway scripts into `e2e/` | `e2e/` is the committed proof suite, keep it green |
| Expecting the counter reset to last | It buys **9 matches** (3 mentors × 3 seats). The 10th finds no seat, the matcher self-heals by recounting REAL active conversations (every earlier run left one), the counters jump to 20+ and everything 503s until the next reset. Reset before every suite; a suite needing >9 matches must end its chats |
| Leaving a mentor's `last_seen_at` set (two-party / mentor-console specs open a console, which stamps it) | 15 min later every General match sweeps that mentor to `away`; onboarding hangs at matching for whoever runs next. Restore the seeded state: `UPDATE listener_profiles SET status='online', last_seen_at=NULL;` |
| Another session editing app files while a spec runs | Fast Refresh reloads the page mid-flow (`navigated to "http://localhost:8081/"` in the timeout log) — rerun, it is not your code |

Output when done: script name(s) run, pass/fail, page-error count, and whether the reduced-motion pass completed.
