# CLAUDE.md — Mento

Brief for any agent working in this repo. Keep it short and true. If it disagrees with the code, fix one of them in the same change.

## What Mento is

An anonymous, low-friction emotional-support app: a person in a hard moment opens it and is talking to a real human in under 30 seconds, with no login and no name. v1 is 18+ anonymous 1:1 chat between members and volunteer mentors ("listener" is the internal/code word; user-facing copy says "mentor").

- Product authority, in order: `docs/DECISIONS.md` → `docs/PRD.md` → `docs/Mockups/` (catalogued in `docs/MOCKUP_INVENTORY.md`). DECISIONS wins on conflict. If DECISIONS is silent, ask; don't guess.

## Scope

Build only v1 scope as defined in `docs/DECISIONS.md`. Deferred and NOT built unless the founder explicitly asks: Module B mentoring, the UPSC self-assessment suite, Community.

## Trust & Safety

- Non-negotiable: server-side crisis scan on every message, 18+ age gate enforced server-side, anonymity on both sides, honest opt-in contributions, real deletion (Clean Wipe), minimal PII, and a privacy policy (`docs/PRIVACY.md`) that matches reality.
- Changes to crisis scan, age gate, deletion (Clean Wipe) or anonymity need tests and explicit user review before PR.

## Working style

- For multi-step tasks, write a short plan and wait for "go".
- When unsure, ask.

## Repo map

```text
apps/mobile/          Expo SDK 55 / React Native 0.83 / expo-router app (TypeScript, web + Android)
  app/ components/    Screens and UI; lib/ = typed API clients and helpers; theme/ = tokens
  e2e/                Node unit tests (*.test.cjs/.mjs), browser e2e (*.e2e.js), Maestro flows
services/api/         FastAPI (Python 3.12), SQLAlchemy 2, Alembic, Procrastinate jobs, pytest
services/recovery_receiver/  Isolated encrypted-recovery receiver service
deploy/               Compose stacks, deploy.sh, bluegreen.sh, backups, monitoring, drills (test-*.sh)
scripts/ci/           Release policy, DB budget and drill tests (python unittest)
scripts/local/        api.py launcher; workspace.ps1 is Windows-only legacy
.github/workflows/    api-ci, test-ci, maestro, staging-release, production-release, rollback-rehearsal
docs/                 Current docs; index in docs/README.md; state in docs/STATUS.md
docs/archive/         STALE. Never read it or use it as guidance.
```

## Environments

| Env | Where | Notes |
|---|---|---|
| Local | `/srv/mento/mento-app` | Dev only; no production data or secrets |
| QA / staging | host `129.121.171.140`; `qa-api`/`qa-app`/`qa-admin.mento.chat` via Caddy (`infra/caddy/`); `staging.mento.chat` kept as an alias pending retirement; reachable over the operator's Tailscale network, not a public IP allowlist; web releases installed by root via `/usr/local/sbin/qa-install-web` | Deployed from `dev` (or uncommitted work) by the `ops/` scripts |
| Production | URL and host to be confirmed | Off limits to agents; deploys only from `main` on request |

## Branch and release rules (founder, 2026-11-11)

One working branch. Keep it lean: no feature branches, no PRs into `dev`.

- Commit to `dev` and push it. Run `ops/ci.sh <sha>` (or `--quick` while iterating) before pushing; never push failing checks unless the user approves.
- QA: you may deploy to QA from `dev`, or from uncommitted work when something must be tested before it is committed. Commit once QA testing passes.
- `main`: merge `dev` into `main` only with the user's explicit approval for that merge. Never push anything else to `main`. Never force-push.
- Production deploys only from `main`, only when the user asks for that specific deploy.
- No GitHub automation: no Actions, no Dependabot. CI/CD is local (`ops/`, `docs/OPERATIONS.md`, `docs/CI.md`).
- Don't delete tags. History lives in `archive/*` tags.

## Commands

Tests use the throwaway Postgres/Redis on 127.0.0.1:5432/6379 (root-managed, no real data). Wrap every DB-using command in `flock /srv/mento/locks/testdb.lock`. Never start/stop those containers.

API (from `services/api`):

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m ruff check .            # lint
.venv/bin/python -m black --check .         # format
.venv/bin/python -m alembic upgrade head
.venv/bin/python -m alembic check           # models and migrations in sync
.venv/bin/python -m pytest                  # tests; they TRUNCATE tables, so never point them at a real DB
```

Mobile (from `apps/mobile`):

```bash
npm ci
npm run typecheck                           # tsc --noEmit; there is no ESLint
npm run test:route && npm run test:question && npm run test:placement && npm run test:bubble
node --test e2e/*.test.cjs                  # unit tests
```

All of the above in one go, in parallel, with a log: `ops/ci.sh <sha>` (full) or `ops/ci.sh --quick <sha>`.

Release tooling (from repo root; these are drills against fakes, not deploys):

```bash
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
bash deploy/test-parity.sh                  # local/prod compose parity + DB pool budget (needs docker)
bash deploy/test-deploy.sh                  # deploy.sh + bluegreen.sh end to end in throwaway containers
bash deploy/test-worker-rollback.sh
```

`deploy/deploy.sh` and `deploy/bluegreen.sh` run on the servers, invoked by the release workflows. Never run them locally against a real host.

## API rules

- Additive only. Add endpoints, fields and optional parameters. Never remove or rename a field, change its type or meaning, or tighten validation on an existing endpoint. Shipped app builds keep calling the old shape.
- To retire something, add the replacement, migrate the clients, and remove the old one only when the user approves.
- Pydantic models in and out. Clients go through the typed wrappers in `apps/mobile/lib/*Api.ts` / `lib/api.ts`.

## Migration rules (expand / contract)

- Expand first: new tables, nullable columns or columns with defaults, new indexes (concurrently where large). This release's code must work with both the old and the new schema.
- Contract later, in a separate release after every running version stops using the old shape: drop columns, add NOT NULL, remove tables.
- Migrations are forward-only. Never edit a shipped migration. `alembic check` must pass.
- Runtime rollback does not undo schema changes, so every migration must be safe under the previous release's code.

## Secrets

- Keys the founder shares go in `/srv/mento/mento-app/.secrets/` (git-ignored, mode 700/600). Write them straight there, never echo them back, reply with the file and variable name only. Production-critical keys (`MESSAGE_KEY`, DB passwords, age private keys) do not go there. Full rules: `docs/SECRETS.md`.
- Never print, log, echo, commit or paste secret values: `.env` files, tokens, keys, the decrypted SOPS env, SSH keys. Refer to secrets by name only.
- `EXPO_PUBLIC_*` values ship inside the client, so they can never hold secrets.
- Production secrets are SOPS + age encrypted (`deploy/secrets/`). Don't decrypt them.

## Docs

- Map: `docs/README.md`. Architecture `docs/ARCHITECTURE.md`; build/CI/CD/release/rollback `docs/OPERATIONS.md`; secrets `docs/SECRETS.md`; hosts and users `docs/environments.md`.
- Pipelines are scripts in `ops/` and `infra/`; never rely on remembered steps. If you do something by hand twice, script it and document it in `docs/OPERATIONS.md`.
- `docs/archive/` is stale. Never read it and never cite it as current.
- After each task, update `docs/STATUS.md`: current state, next 3 tasks, open questions. Keep it at 20 lines or fewer.
- When you add, move or retire a doc, update `docs/README.md`.
