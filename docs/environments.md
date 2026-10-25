# Environments

Where Mento runs, who owns what, and how a release moves today. Secrets are named, never valued. Facts below were read from the repo and, for QA, from `/opt/mento-staging` on the QA box (read-only, `secrets/` excluded). Anything not confirmed is marked.

## QA (staging)

| | |
|---|---|
| Host | `129.121.171.140` (single box; reachable over the operator's Tailscale network, not a public IP allowlist) |
| URLs | `qa-api.mento.chat`, `qa-app.mento.chat`, `qa-admin.mento.chat`; `staging.mento.chat` kept as an alias pending retirement |
| Edge | Caddy (systemd `caddy.service`, `/etc/caddy/Caddyfile`). Nginx + certbot disabled at the 2026-10-23 cutover, not removed. Cutover record: `infra/caddy/*.md` on `feat/qa-caddy` |
| Linux users | `root` (runs `qa-install-web`, `qa-deploy-api`, owns `ci.lock`, `ci.override.yml`, `web`, `previous-web`); `mento-ops` (owns `compose.yml`, `proxy.conf`, `release.json`, `secrets/`); `mento-ci-staging` (forced-command SSH user for the Staging Release workflow, sudo only to `ci-receiver.py staging`, per `deploy/install-ci-staging.sh`) |
| Compose project | `mento-staging`, working dir `/opt/mento-staging` |

Containers (all `restart: unless-stopped`, memory/CPU capped in `compose.yml`):

| Service | Image | Port | Notes |
|---|---|---|---|
| `api` | `mento-api:<tag>` | `127.0.0.1:18010` → 8000 | Caddy proxies here. One instance, no blue/green on QA |
| `worker` | `mento-api:<tag>` | none | `python -m app.jobs.worker` |
| `migrate` | `mento-api:<tag>` | none | profile `tools`, one-off `alembic upgrade head` |
| `postgres` | `postgres:16-alpine` | none published | volume `pgdata`, `max_connections=30` |
| `valkey` | `valkey/valkey:8-alpine` | none published | 48 MB, no persistence |

The live `<tag>` comes from `ci.override.yml`, not `compose.yml`. `compose.yml` still pins the stale `mento-api:staging-6e47f7a`; the override replaces it for `api`, `worker` and `migrate`.

Config and secrets (names only):

- `/opt/mento-staging/compose.yml`: base stack (copy of `deploy/staging/compose.yml`).
- `/opt/mento-staging/ci.override.yml`: image tag per service. Root-owned.
- `/opt/mento-staging/secrets/api.env`, `secrets/db.env`: env files for API/worker and Postgres. Mode 700 directory, owner `mento-ops`. Never read by agents.
- `/opt/mento-staging/web` → `web-releases/<release>`: the static web build Caddy serves; `previous-web` is the release before it.
- `/opt/mento-staging/ci.lock`: flock file taken by deploys.
- `current-sha`, `candidates/`, `predeploy-backups/`, `runtime-image-ids/`, `release.json`: release bookkeeping written by the receiver.
- New with `ops/qa-deploy-api.sh`: `previous-api-tag`, `deploy-history.log`, `ci.override.yml.bak.*`.
- `/opt/mento-staging/README.md` is stale: it still calls this box "VPS B 31.42.125.238" and names an artifact from commit 6e47f7a.

### QA secrets (encrypted, in git)

QA's encrypted settings are committed in `deploy/staging/secrets/`:

| File | Holds |
|---|---|
| `api.enc.env` | API and worker settings (env file for the `api`, `worker` and `migrate` containers) |
| `db.enc.env` | Postgres role and database settings |

Both are SOPS dotenv files encrypted with age. `.sops.yaml` has a creation rule for `deploy/staging/secrets/*.enc.env` with exactly two recipients and no others:

- **QA server key.** The private key is `/etc/mento/age/qa.key` on the QA box (`129.121.171.140`), readable by root only.
- **QA recovery key.** The private key is kept in the team password manager, so a lost box never loses the secrets.

The production rule (`deploy/secrets/prod.env.sops.yaml`) is separate and unchanged. No private keys appear in this repo or its docs.

Plaintext `*.env` files in `deploy/staging/secrets/` are gitignored; only `*.enc.env` is tracked (`.gitignore`).

Until deploy decrypts automatically, the encrypted file in git is the source of truth: edit with `sops deploy/staging/secrets/<f>.enc.env`, then root renders it to /opt/mento-staging/secrets/<f>.env. Never edit the plaintext on the box directly.

Editing needs a key that is a recipient, for example on the QA box as root:

```bash
SOPS_AGE_KEY_FILE=/etc/mento/age/qa.key sops deploy/staging/secrets/api.enc.env
```

`sops` re-encrypts to the two recipients above on save. Do not decrypt to a file in the repo.

### Deploy today

1. Staging Release workflow (`.github/workflows/staging-release.yml`) builds the candidate, then SSHes as `mento-ci-staging@129.121.171.140` and runs `receive <sha>`, `deploy <sha>`, `accept <sha>`, `fixture`, `cleanup`, `verify`. Those commands are handled by `ci-receiver.py` (root-owned, `/usr/local/lib/mento-release/`). Only that workflow deploys QA automatically; agents never trigger it unless asked for that run.
2. Web only: root runs `/usr/local/sbin/qa-install-web <tarball.tar.gz>` (verifies the `.sha256`, unpacks to `web-releases/<name>`, atomically flips `web`, saves the old target as `previous-web`).
3. API by hand (new): root runs `ops/build-api.sh <sha>` output to build `mento-api:<shortsha>-r<N>` (never reuses a tag; the commands print the tag), then `qa-deploy-api [--skip-ci-check] <shortsha>-r<N>`: refuses an image whose commit has no passing `ops/ci` log in `/srv/mento/logs/ci/`, dumps the database to `predeploy-backups/` (a failed dump aborts before anything changes), backs up and rewrites `ci.override.yml`, migrates through the `api` service with the same image, recreates `api` + `worker`, waits up to 60 s for HTTP 200 on `https://qa-api.mento.chat/api/v1/health/ready`, and rolls back automatically if that fails. Every run appends tag and Alembic revision before/after to `deploy-history.log`.

### Rollback today

- Web: `qa-install-web --rollback` swaps `web` and `previous-web`.
- API: `qa-deploy-api --rollback` restores the tag in `previous-api-tag` (and swaps it, so a second run undoes the first). It changes the image only; **database migrations are not undone**. Expand/contract rules mean the old image must run on the newer schema; `deploy-history.log` shows the revision each tag last ran with.
- Before `qa-deploy-api` existed, the only API path was the receiver's own handling inside the workflow; whether the receiver has a rollback command was not verified.

### Backups, CI trigger and Actions (added 2026-10-25, not yet installed)

- **Backups.** A plaintext nightly dump already lands in `/opt/mento-backups/mento-*.sql.gz` on the QA box (14 Oct onward). It is local-only and unencrypted. `ops/qa-backup.sh` (install as `/usr/local/sbin/qa-backup`) writes an age-encrypted dump to `/opt/mento-backups/qa-encrypted/` using the public recipients in `/etc/mento/age/qa.recipients`, copies off-box when `QA_BACKUP_REMOTE` (an rclone destination) is set, and keeps 14 days locally. `ops/qa-restore-drill.sh` restores the newest archive into a throwaway no-network container weekly. Units: `infra/systemd/mento-qa-backup.*`, `mento-qa-restore-drill.*`. Retire the plaintext job only after the first drill passes.
- **CI trigger.** `ops/ci-poll.sh` (timer `infra/systemd/mento-ci-poll.*`, runs as `agent`) runs `ops/ci.sh` for each new `dev`, `main` and `feat/*` head and posts the `ops/ci` status. Run `ops/ci-poll.sh --seed` once before enabling the timer so old branches are not re-tested.
- **Actions release path is broken.** `staging-release.yml` and `production-release.yml` require `master`, which no longer exists, and `test-ci.yml` pushes only on `master`. Nothing deploys through Actions until that is decided: see [specs/qa-deploy-path.md](specs/qa-deploy-path.md).

## Production

Off limits to agents. Nothing below was verified against a live host.

| | |
|---|---|
| Host(s) | TBD (audit Mon). `deploy/domains.env` lists `VPS_SSH=mento-ops@129.121.122.28`; unverified. `docs/DEPLOYMENT_VPS.md` describes an older box (`87.232.72.79`), treat as stale |
| URLs | TBD (audit Mon). `deploy/domains.env` defines `api.` / `app.` / `admin.` under `ROOT_DOMAIN=mento.chat` |
| Linux users | TBD (audit Mon). Repo assumes `mento-ops` and `mento-ci-production` (`deploy/install-ci-production.sh`) |
| Containers and ports | TBD (audit Mon). Repo designs: legacy stack `deploy/docker-compose.prod.yml` behind host Nginx, or Balanced stack (`compose.base.yml` + `compose.prod.yml`, Caddy, `api_blue`/`api_green`) |
| Config | TBD (audit Mon). Repo: `deploy/secrets/prod.env.sops.yaml` (SOPS + age), decrypted to tmpfs by `deploy/decrypt-env.sh`, or `services/api/.env`; stack choice in `MENTO_STACK` or `~/.config/mento/stack` |
| Deploy | Per `deploy/deploy.sh`, run on the server from `/opt/mento`: build `mento-api:<sha>`, one-off `alembic upgrade head`, then swap (blue/green on Balanced; recreate with auto put-back on legacy). Invoked by the Production Release workflow. Which stack runs today: TBD (audit Mon) |
| Rollback | Per `deploy/deploy.sh --rollback`: previous image, no migrations. Not rehearsed on a live host as far as the repo shows (`rollback-rehearsal` workflow exists). TBD (audit Mon) |

## Error reporting (Sentry)

Errors only: no tracing, no session replay, no screenshots, no breadcrumbs. Events pass a
`before_send` / `beforeSend` scrubber that drops message text, exception messages, request
bodies and headers, user data and IPs (`services/api/app/observability.py`,
`apps/mobile/lib/sentryConfig.ts`). Sentry is off unless there is a DSN **and** the
environment value below is one of `qa`, `staging` (reported as `qa`), `prod` or `production` (reported as `production`);
anything else, including unset or `dev`, is off. It never defaults to production.

Mobile reports JS-level errors only (`enableNative: false`): native crash events would bypass the
JS `beforeSend` scrubber, so native crash reporting stays off until a native scrubber exists.

| Variable | Where | Purpose |
|---|---|---|
| `SENTRY_DSN` | API | Project DSN. Empty = off. |
| `ENV` | API | `qa` / `staging` → Sentry env `qa`; `prod` / `production` → `production`; else off. |
| `GIT_SHA` | API | Sentry `release`. Supplied by the ops scripts; empty = no release. |
| `EXPO_PUBLIC_SENTRY_DSN` | web + mobile | Project DSN (ships in the client, so it must not be a secret). Empty = off. |
| `EXPO_PUBLIC_APP_ENV` | web + mobile | Same mapping as `ENV`. |
| `EXPO_PUBLIC_GIT_SHA` | web + mobile | Sentry `release`. Supplied by the ops scripts. |
