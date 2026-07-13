---
name: mento-e2e
description: Use when proving a user-facing Mento flow in the browser, writing or running e2e scripts, or when e2e runs hit 429s, 503s, or flake between runs.
---

# Mento E2E — write & run browser proofs

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

Output when done: script name(s) run, pass/fail, page-error count, and whether the reduced-motion pass completed.
