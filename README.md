# Mento

An anonymous, low-friction emotional-support application with a shared onboarding base for members and mentors. The current v1 is 18+ anonymous support. UPSC, NEET and JEE are the community direction; verified professional mentoring, payments and broader sectors require their own agreed scope.

**Start here:** [Current status](docs/STATUS.md) · [Docs index](docs/README.md) · [Product decisions](docs/DECISIONS.md) · [Project brief](CLAUDE.md)

## Last verified status — 3 October 2026 (historical; see docs/STATUS.md)

- Expo 54 and 55 upgrade PRs #11 and #12 merged after successful Android send/reply checks. Current mobile source uses **Expo 55 / React Native 0.83.10**.
- Release foundation PR #13 and cookbook PR #14 are merged. Exact master API, web and Android checks passed for `f617473`.
- **Full CI staging acceptance passed:** [run 37093153629](https://github.com/trendywink247-afk/mento-app/actions/runs/37093153629) deployed `f617473`, verified schema/safety, isolated backup restore and browser flows, cleaned the synthetic fixture and published the accepted release artifact. Live runtime identity was independently verified afterwards.
- Production application remains on the older deployment. Its API is healthy, but no new job worker is running and the crisis-webhook freshness probe is stale. Production promotion is disabled.
- Remaining: production operational gates, dependency security findings, load/device acceptance and iOS/App Store readiness. Passing tests are not an enterprise launch certification.

## Architecture

The original **Balanced Architecture Book** remains the baseline. The [Balanced architecture spec](docs/specs/2026-09-20-mento-balanced-architecture-design.md) is the current design reference.

[Current architecture image](docs/diagrams/mento-current-architecture.png) · [Target architecture image](docs/diagrams/mento-desired-architecture.png)

![Current architecture: dated 2 October snapshot](docs/diagrams/mento-current-architecture.png)

The diagram is the **2 October topology snapshot**. Android acceptance and release tooling have progressed since it was drawn; the status above and `docs/STATUS.md` record that delta. The current UI uses Stream Chat; an own-chat backend is not a completed UI migration.

![Target architecture: proposed growth design](docs/diagrams/mento-desired-architecture.png)

The target is a design, not the deployed state.

## Environments and connections

| Environment | Address | Actual role |
|---|---|---|
| Development | `/srv/mento/mento-app`; web `18081`, API `18000` | Local development; isolated Docker Postgres `15432` and Valkey `16379` |
| Production / VPS A | `129.121.122.28` | Nginx, static web, older FastAPI, self-hosted Postgres 16 and Redis 7; about 4 GB RAM / 2 CPU |
| Staging | `129.121.171.140` | Restricted `staging.mento.chat`, API/worker, isolated Postgres/Valkey (target of Staging Release since PR #90) |
| Chat transport | Stream Chat | Clients connect to Stream; signed server-to-server hooks enforce safety on the API |

Monitoring (Uptime Kuma, external monitor) and the off-box backup target are still configured for the former staging host in `deploy/`; their current location is an open question in `docs/STATUS.md`. These two servers are **not** an automatic failover cluster. Independent monitoring and encrypted recovery storage remain target improvements.

## Repository map

```text
apps/mobile/          Expo Router app: onboarding, member/mentor chat, journals, staff UI
  components/         UI, motion, onboarding and chat components
  lib/                API client, identity/session and domain helpers
  e2e/                Browser flows and Maestro native tests
services/api/         FastAPI, SQLAlchemy 2, Alembic, jobs and pytest
scripts/local/        Workspace launchers and isolated test database
scripts/ci/           Exact-commit release policy and archive tests
deploy/               Compose, SSH access, receiver, staging and recovery scripts
.github/workflows/    API CI, Test CI, Maestro, Staging Release, Production Release
docs/                 Decisions, PRD, privacy, runbooks, specs, diagrams (index: docs/README.md)
docs/STATUS.md        Current state, next tasks, open questions
docs/archive/         Stale history; do not use as current guidance
```

## Local development

Work in `/srv/mento/mento-app`. Prerequisites: Node 22 (CI parity), npm, Python 3.12+, PowerShell 7 (for `scripts/local/workspace.ps1`) and Docker. If dependencies are not installed, create `services/api/.venv`, install `services/api/requirements-dev.txt` into it, and run `npm ci` in `apps/mobile`. Never copy production secrets into a development configuration.

```bash
cd /srv/mento/mento-app
pwsh -File scripts/local/workspace.ps1 init
# Run each service in its own terminal, from the same folder:
pwsh -File scripts/local/workspace.ps1 api
pwsh -File scripts/local/workspace.ps1 worker
pwsh -File scripts/local/workspace.ps1 web
```

Open <http://localhost:18081>. These wrappers ignore copied application `.env` files, use `mento_dev`, and run tests against `mento_test`. Local push is disabled. The opt-in `.local/stream.env` is ignored by Git; its non-production Stream app currently points at staging hooks. Do not repoint those hooks or run simultaneous independent local live-chat tests against it. Use hermetic tests or a separate development Stream application.

## Verify a change

```powershell
# From repository root:
pwsh -File scripts/local/workspace.ps1 status
pwsh -File scripts/local/workspace.ps1 check
pwsh -File scripts/local/workspace.ps1 test
services/api/.venv/bin/python -m unittest discover -s scripts/ci -p 'test_*.py'
# From apps/mobile:
npx tsc --noEmit
npm run test:route
npm run test:question
npm run test:placement
npm run test:bubble
```

Browser acceptance runs at 390 × 844, normally and with reduced motion, with zero page errors. Native CI verifies sent messages and mentor replies on an Android emulator. iOS physical-device/TestFlight acceptance remains separate. Use the isolated test wrapper instead of running raw pytest against a development or production database.

## Release and recovery

1. Develop locally, verify touched layers, and open/review a PR.
2. Merge only with current successful checks; then require successful **master-push checks for the exact SHA**.
3. Run Staging Release: build once, checksum, deploy, migrate, verify safety/restore/browser behavior, and publish the accepted candidate.
4. Complete the production checklist before enabling promotion. Production Release reuses that accepted candidate without rebuilding.
5. Observe errors, latency, worker backlog and saturation before expanding exposure.

The workflow definitions in `.github/workflows/` and the scripts in `deploy/` are the source of truth for release mechanics. Database migrations must remain backward-compatible: runtime rollback does not automatically reverse schema changes. Legacy automatic production workflows are disabled.

## Safety and configuration

Never commit `.env`, private keys, tokens or user/message data. `EXPO_PUBLIC_*` variables are bundled into the client and cannot hold secrets. API role keys and Stream server credentials stay server-side. Read package `.env.example` files for configuration and `CLAUDE.md` for implementation conventions.

Preserve anonymity, 18+ age gating, crisis enforcement, honest payment states, deletion semantics and PII minimization. Keep a single shared onboarding base; do not infer a new bureaucrat-specific onboarding flow. Product decisions are authoritative over older PRDs and mockups.

## Working references

- [Decisions](docs/DECISIONS.md), [PRD](docs/PRD.md), [project brief](CLAUDE.md).
- [Docs index](docs/README.md) and [current status](docs/STATUS.md).