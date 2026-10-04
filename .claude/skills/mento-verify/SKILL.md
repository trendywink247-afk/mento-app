---
name: mento-verify
description: Use before claiming any Mento change is done, fixed, or passing, before any commit, and when deciding which checks a change needs.
---

# Mento verification gate

**Nothing is "done" until the checks for every touched layer pass. Evidence before assertions.**

## Which checks (by touched layer)

| Touched | Required checks (run from the layer's dir) |
|---|---|
| `services/api/**` | From repo root: `services/api/.venv/Scripts/python.exe scripts/local/api.py test` → then `services/api/.venv/Scripts/python.exe scripts/local/api.py check` |
| `apps/mobile/**` | `npx tsc --noEmit` (the only JS gate — no ESLint exists) |
| Any user-facing flow | Drive it in the browser per the **mento-e2e** skill: 390×844, 0 page errors, once normal + once `reducedMotion: 'reduce'` |
| DB models | New Alembic revision (`-m alembic revision --autogenerate -m "..."`); never edit a shipped one |

## Isolate test data

Use `scripts/local/workspace.ps1` and `scripts/local/api.py` from the H: checkout. The test launcher selects `mento_test` on port 15432 and Valkey index 1, clears copied environment configuration and external credentials, and never truncates `mento_dev`. Do not run default pytest against legacy localhost:5432 or reseed legacy containers after isolated tests. Initialize the workspace with `pwsh -File scripts/local/workspace.ps1 init`; it seeds the isolated development mentor pool only when empty.

The historical default pytest path could truncate a serving development roster. That is a reason to use the isolated launcher, not to run reseeding commands against the old shared stack. Local live Stream acceptance additionally requires its own provider application; the previously copied project is assigned to staging.

## Test-required list (no merge without a test)

matching · routing · crisis-scan · payments · age-gate · paths · listener-console auth/scoping · admin auth/scoping.

## Red flags — you are about to ship unverified work

| Thought | Reality |
|---|---|
| "tsc passed, so the flow works" | tsc proves types, not behavior. Drive the flow. |
| "Default pytest is equivalent to the workspace launcher" | It can select the legacy database. Use the isolated launcher and preserve serving data. |
| "Reduced-motion is just an accessibility nicety" | It's a hard DoD line; the run must stay static AND complete. |
| "The suite count matches CLAUDE.md" | Counts drift. Green pytest output is the only truth. |

Output when done: state each check run and its literal result (e.g. "54 passed", "tsc clean", "e2e 0 page errors"). If anything failed, report the failure — never claim partial success as done.
