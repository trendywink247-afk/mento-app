# Production (on the QA box until launch)

Founder decision 2026-11-11: production runs on `129.121.171.140` beside QA, isolated from it, until
launch; then it moves to its own host. Production deploys **only commits on `origin/main`**, and only
when the founder asks. Nothing here is started by an agent on its own.

## Layout

| What | Where |
|---|---|
| Sites | `api.mento.chat` (API + `/ota`), `app.mento.chat` (web app), `admin.mento.chat` (staff console: loopback, Tailscale 100.64.0.0/10 and an optional operator IP only) |
| Edge | Caddy, `infra/caddy/prod.caddy` -> `/etc/caddy/mento-prod.caddy`, one `import` line at the end of `/etc/caddy/Caddyfile` |
| Stack | Compose project `mento-prod`, `/opt/mento-prod/compose.yml` (from `deploy/prod-local/compose.yml`): postgres, valkey, api `127.0.0.1:18110`, worker, migrate (tools). Own network and volume; only the API is published, on loopback |
| Secrets | `/opt/mento-prod/secrets/{api.env, db.env, files/fcm.json}`, root 700/600. Non-secret settings are in the compose file so they cannot drift |
| Release state | `release.env` (live tag + commit), `previous-release.env`, `release-history.log` (who, what, schema before/after, result) |
| Web | `/opt/mento-prod/web` -> `web-releases/<release>`, `previous-web` for rollback; the five newest are kept |
| OTA | `mento-ota-prod.service`, 127.0.0.1:18120, data `/opt/mento-prod/ota-data`, signing key `/etc/mento/ota/prod-private-key.pem` (root 600); same code and venv as QA's (`/opt/mento-ota`) |
| Backups | `/opt/mento-backups/prod-encrypted/` nightly, `prod-predeploy/` before every release; age recipients `/etc/mento/age/prod.recipients` |

## Budget (15 GB box)

| Component | Cap | Used now |
|---|---|---|
| QA stack (api, worker, postgres, valkey) | 0.85 GB | ~0.27 GB |
| SonarQube + its Postgres | 2.5 GB (3.5 GB once raised to 3 GB) | ~1.7 GB |
| Shared test DB (`mento-postgres`, `mento-redis`; root-managed, uncapped) | none | ~1.0 GB |
| **Production**: postgres 768 MB, valkey 192 MB, api 768 MB, worker 384 MB (migrate 384 MB, only while migrating) | **2.1 GB** | 0 (not started) |
| Two OTA servers (`MemoryMax=256M` each) | 0.5 GB | small |
| Caddy | ~0.1 GB | small |
| **Total caps** | **~7.1-8.1 GB** | |

That leaves ~7 GB for APK builds (Gradle peaks at 4-6 GB), web exports and the page cache. Avoid
running an APK build, a SonarQube scan and a production release at the same moment.
Database connections: `max_connections=40` against API 2 workers x (4+2) = 12, worker 6 plus its
job-queue connector, migrate, backups and `alembic current`.

## First-time setup (root)

```bash
sudo bash infra/prod-root-setup.sh --dry-run          # see every step
sudo bash infra/prod-root-setup.sh [--recovery-recipient age1...]
```

It creates the layout, generates the database password and three distinct JWT secrets (never
printed), a backup key for this box, installs the backup timers and the production OTA unit, and
prints the founder checklist below. It does not start the application.

## Founder checklist

1. `MESSAGE_KEY`: `cd services/api && .venv/bin/python -m app.services.message_crypto k1` on a trusted
   machine -> `/opt/mento-prod/secrets/api.env` and the password manager. Losing it makes chats unreadable.
2. `STREAM_API_KEY` / `STREAM_API_SECRET` (production Stream app) -> `api.env`. The API refuses to boot without them.
3. FCM service account -> `/opt/mento-prod/secrets/files/fcm.json` (root 600).
4. Sentry (optional): API prod DSN -> `api.env` `SENTRY_DSN`; app prod DSN and `EXPO_PUBLIC_STREAM_API_KEY` -> `.secrets/prod.env`.
5. OTA signing key, once: `ops/ota-keygen.sh prod apps/mobile/certs/ota-prod.pem /etc/mento/ota/prod-private-key.pem`;
   commit the certificate, keep the key in the password manager, re-run the setup (starts the OTA server).
6. Offline backup recovery key: `age-keygen` on your machine, re-run setup with `--recovery-recipient`, set
   `PROD_BACKUP_REMOTE` in `/etc/mento/prod-backup.env`.
7. DNS: `app`, `api`, `admin.mento.chat` A records -> `129.121.171.140` (today: `129.121.122.28`, the old server),
   then `sudo bash infra/prod-root-setup.sh --with-caddy [--admin-ip <your ip>]`. It refuses until DNS points here.
8. Merge `dev` -> `main` (founder approval), `ops/ci.sh <main sha>`, then release (below).
9. Retire `129.121.122.28` (test data only). Remove the unused `GLITCHTIP_SECRET_KEY` from the SOPS file if you keep it.

## Release

```bash
ops/ci.sh <sha>                                        # the CI pass the release requires
sudo ops/prod-release.sh <sha> --dry-run               # guards + plan, changes nothing
sudo ops/prod-release.sh <sha> --yes-production        # the release
ops/prod-release.sh --status
```

Refuses unless the commit is on `origin/main`, ops/ci passed for it, and `api.env` has every required
name set (it reads names, never prints values). Order: build the web export -> build
`mento-api:prod-<sha12>-r<N>` -> encrypted pre-deploy dump (failure aborts) -> migrate -> recreate api +
worker -> health on `127.0.0.1:18110/api/v1/health/ready` (unhealthy -> automatic rollback to the
previous image) -> swap the web release. Every step before the migration changes nothing live.

## Rollback

```bash
sudo ops/prod-release.sh --rollback --yes-production   # previous image AND previous web release
```

Migrations are never undone (expand/contract rules: the previous image must run on the newer schema).
A second rollback undoes the first.

## OTA (JS-only app updates)

```bash
ops/ota-publish.sh prod -m "what changed"              # build from origin/main as agent -> tarball
sudo ops/ota-publish.sh --install-prod <tarball> --yes-production
sudo ops/ota-publish.sh --rollback production <runtime> --yes-production
```

The build refuses a commit that is not on `origin/main`, or whose native layer differs from the store
build's fingerprint (`OTA_EXPECT_FP`, or `/opt/mento-prod/state/store_fp`). The install re-checks main.

## Backups

Nightly 02:45 UTC (`mento-prod-backup.timer`): `pg_dump` -> gzip -> age to the recipients -> local 30 days,
off-box copy when `PROD_BACKUP_REMOTE` is set (a failed copy fails the run). Weekly Sunday restore drill
into a throwaway, network-less container (`mento-prod-restore-drill.timer`). Both exit 0 before the first release.

## CSP

`app` and `admin` send a Content-Security-Policy built for the Expo web export. It was tested by
loading the real exported bundle in headless Chromium under that policy: zero violations, all screens
rendered; with the API removed from `connect-src` the same run reported violations, so the check works.
If a new third-party origin is added to the app, add it to `prod_csp` in `infra/caddy/prod.caddy`.

## Isolation and its limits

This box is agent-accessible, and the agent has sudo, so **production data on it is reachable by the
agent**. That is accepted until launch. What limits it:
- secrets are root-only files, never printed by any script; the agent refers to them by name;
- production changes only through `ops/prod-release.sh` / `ota-publish.sh --install-prod`, which refuse
  anything not on `main` and need `--yes-production`; CLAUDE.md forbids running them unless the founder asks;
- every release, rollback and OTA install is logged with the invoking user
  (`release-history.log`, `ota-data/install-history.log`);
- production has its own database, cache, network, keys and backups; nothing is shared with QA.

At launch, move production to its own host where the agent has no access.
