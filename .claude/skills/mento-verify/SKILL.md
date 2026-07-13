---
name: mento-verify
description: Use before claiming any Mento change is done, fixed, or passing, before any commit, and when deciding which checks a change needs.
---

# Mento verification gate

**Nothing is "done" until the checks for every touched layer pass. Evidence before assertions.**

## Which checks (by touched layer)

| Touched | Required checks (run from the layer's dir) |
|---|---|
| `services/api/**` | `.\.venv\Scripts\python.exe -m pytest` → then `-m alembic check` → then **re-seed** (below) |
| `apps/mobile/**` | `npx tsc --noEmit` (the only JS gate — no ESLint exists) |
| Any user-facing flow | Drive it in the browser per the **mento-e2e** skill: 390×844, 0 page errors, once normal + once `reducedMotion: 'reduce'` |
| DB models | New Alembic revision (`-m alembic revision --autogenerate -m "..."`); never edit a shipped one |

## The trap that wastes hours

`pytest` **truncates the dev DB's listeners**. After any pytest run:

```powershell
cd services/api; .\.venv\Scripts\python.exe -m scripts.seed_listeners
```

Skip it and matching returns **503** — that's not a matcher bug. Old listener token-links also die with re-seeded listener ids; issue fresh ones (`python -m scripts.issue_listener_token`).

## Test-required list (no merge without a test)

matching · routing · crisis-scan · payments · age-gate · paths · listener-console auth/scoping · admin auth/scoping.

## Red flags — you are about to ship unverified work

| Thought | Reality |
|---|---|
| "tsc passed, so the flow works" | tsc proves types, not behavior. Drive the flow. |
| "Tests passed, skip the reseed" | Next session debugs a phantom 503. Reseed now. |
| "Reduced-motion is just an accessibility nicety" | It's a hard DoD line; the run must stay static AND complete. |
| "The suite count matches CLAUDE.md" | Counts drift. Green pytest output is the only truth. |

Output when done: state each check run and its literal result (e.g. "54 passed", "tsc clean", "e2e 0 page errors"). If anything failed, report the failure — never claim partial success as done.
