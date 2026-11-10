# Mento

An anonymous, low-friction emotional-support application. A person in a hard
moment opens it and is talking to a real human in under 30 seconds — no
login, no name. v1 is 18+ anonymous 1:1 chat between members and volunteer
mentors ("listener" is the internal/code word; user-facing copy says
"mentor"). UPSC, NEET and JEE are the first community direction; verified
professional mentoring, payments and broader sectors are out of scope until
separately agreed.

**Start here:** [Current status](docs/STATUS.md) · [Docs index](docs/README.md) · [Product decisions](docs/DECISIONS.md) · [Project brief](CLAUDE.md)

## Recent progress

- **Repository consolidation.** Stale docs, the old project brief and
  one-off agent skills moved to `docs/archive/` (never read it as current
  guidance); `CLAUDE.md` rewritten short; Dependabot retargeted at `dev`.
- **GitHub's default branch is now `main`**, not `master`.
- **QA moved from Nginx to Caddy.** `qa-api`/`qa-app`/`qa-admin.mento.chat`
  are live on the staging box behind Caddy; Nginx and certbot are disabled
  there (not removed — a documented rollback exists); `staging.mento.chat`
  is kept serving as an alias for now. Full record, the Caddyfile and the
  as-run runbook are under `infra/caddy/` once merged from its branch.
  Web releases there install via `/usr/local/sbin/qa-install-web`
  (`ops/qa-install-web.sh`, once merged).
- Current state, the live next-tasks list and open questions: `docs/STATUS.md`.

## Stack

| Layer | Choice |
|---|---|
| Mobile | Expo SDK 55 (React Native 0.83, TypeScript), expo-router — web + Android; iOS acceptance separate |
| Chat | Stream Chat today; an own-chat backend exists server-side but is not the serving UI yet |
| Backend | FastAPI (Python 3.12), SQLAlchemy 2, Alembic, Procrastinate job queue, pytest |
| Data | Postgres 16, Redis (Valkey in staging) |
| Edge | QA: Caddy (as of the 2026-10-23 cutover). Production: Nginx (unchanged) |

## Environments

| Environment | Where | Role |
|---|---|---|
| Local | `/srv/mento/mento-app`; web `8081`, API `8000` | Dev only; isolated Postgres/Redis; no production data |
| Production | VPS A, `129.121.122.28` | Nginx, static web, self-hosted Postgres 16 + Redis 7; public |
| QA / staging | VPS B, `129.121.171.140` | `qa-api`/`qa-app`/`qa-admin.mento.chat` via Caddy; `staging.mento.chat` kept as an alias pending retirement; reachable over the operator's Tailscale network, not a public IP allowlist |
| Chat transport | Stream Chat | Clients connect to Stream directly; signed server-to-server hooks enforce the crisis scan on the API |

Production and QA/staging are **not** an automatic failover cluster — each
has its own database, secrets and Stream application. Monitoring
(Uptime Kuma, `deploy/external-monitor.sh`) and the off-box backup target
still need reconfirming against QA's current host; see `docs/STATUS.md`.

## Repository map

```text
apps/mobile/          Expo Router app: onboarding, member/mentor chat, journals, staff UI
  components/         UI, motion, onboarding and chat components
  lib/                API client, identity/session and domain helpers
  e2e/                Browser flows and Maestro native tests
services/api/         FastAPI, SQLAlchemy 2, Alembic, jobs and pytest
services/recovery_receiver/  Isolated encrypted-recovery receiver service
scripts/ci/           Exact-commit release policy and drill tests (python unittest)
deploy/               Compose stacks, deploy.sh, bluegreen.sh, backups, monitoring, drills
infra/caddy/          QA Caddy cutover: Caddyfile, runbook, findings (feat/qa-caddy, pending merge)
ops/                  Operational scripts run on a server (e.g. qa-install-web.sh, pending merge)
.github/workflows/    API CI, Test CI, Maestro, Staging Release, Production Release
docs/                 Decisions, PRD, privacy, runbooks, specs, diagrams (index: docs/README.md)
docs/STATUS.md        Current state, next tasks, open questions
docs/archive/         Stale history — never use as current guidance
```

## Local development

Work in `/srv/mento/mento-app`. Prerequisites: Node 22, npm, Python 3.12+.
If dependencies aren't installed: create `services/api/.venv` (this repo
uses `uv`), install `services/api/requirements-dev.txt` into it, and run
`npm ci` in `apps/mobile`. Never copy production secrets into a development
configuration.

```bash
cd services/api
uv venv --python 3.12 && source .venv/bin/activate
uv pip install -r requirements.txt -r requirements-dev.txt
# A local Postgres 16 + Redis matching docker-compose.yml must already be running.
python -m alembic upgrade head
python -m uvicorn app.main:app --port 8000   # Swagger at /docs

cd ../../apps/mobile
npm ci
npx expo start --web --port 8081
```

Local push is disabled. The opt-in `.local/stream.env` (git-ignored) can
point a non-production Stream application at local dev — never repoint
production's or QA's hooks for local testing.

## Verify a change

```bash
# services/api touched:
python -m ruff check .
python -m black --check .
python -m alembic upgrade head && python -m alembic check
python -m pytest                     # TRUNCATEs tables — never point at a real DB

# apps/mobile touched:
npm run typecheck                    # tsc --noEmit; there is no ESLint
npm run test:route && npm run test:question && npm run test:placement && npm run test:bubble
node --test e2e/*.test.cjs           # unit tests run in CI; see test-ci.yml for the exact list

# repo root:
python3 -m unittest discover -s scripts/ci -p 'test_*.py'
bash deploy/test-parity.sh           # renders compose config only; no running daemon needed
bash deploy/test-worker-rollback.sh  # mocks docker entirely; no daemon needed
bash deploy/test-deploy.sh           # builds and runs real containers — needs real docker access
```

Paste pass/fail counts in the PR description; never open a PR with failures
unless the user explicitly approves (see `CLAUDE.md`'s branch rules).

## Release and recovery

1. Develop on a `feat/<topic>` branch off `dev`; verify touched layers; ask
   before opening a PR into `dev`.
2. Merge only with current, successful PR checks; then require successful
   **main-push checks for the exact SHA** before it's used for a release.
3. Run Staging Release: build once, checksum, deploy, migrate, verify
   safety/restore/browser behavior, publish the accepted candidate.
4. Complete the production checklist before enabling promotion. Production
   Release reuses that accepted candidate without rebuilding.
5. Observe errors, latency, worker backlog and saturation before expanding
   exposure.

`.github/workflows/` and `deploy/` are the source of truth for release
mechanics. Migrations must stay backward-compatible — runtime rollback does
not reverse schema changes. Never deploy to production, or trigger a
staging/production release workflow, unless explicitly asked for that run.

## Safety and configuration

Non-negotiable: server-side crisis scan on every message, 18+ age gate
enforced server-side, anonymity on both sides, real deletion (Clean Wipe),
minimal PII, and a privacy policy (`docs/PRIVACY.md`) that matches reality.
Changes to any of these need tests and explicit user review before a PR.

Never commit `.env` files, private keys, tokens, the decrypted SOPS env, SSH
keys or user/message data. `EXPO_PUBLIC_*` variables ship inside the client
and can never hold secrets. Production secrets are SOPS + age encrypted
(`deploy/secrets/`) — don't decrypt them. Read each package's `.env.example`
for configuration and `CLAUDE.md` for implementation conventions.

## Working references

- [Decisions](docs/DECISIONS.md) (authoritative over the PRD/mockups on any
  conflict) · [PRD](docs/PRD.md) · [project brief](CLAUDE.md)
- [Docs index](docs/README.md) · [current status](docs/STATUS.md)
