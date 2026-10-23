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

### Deploy today

1. Staging Release workflow (`.github/workflows/staging-release.yml`) builds the candidate, then SSHes as `mento-ci-staging@129.121.171.140` and runs `receive <sha>`, `deploy <sha>`, `accept <sha>`, `fixture`, `cleanup`, `verify`. Those commands are handled by `ci-receiver.py` (root-owned, `/usr/local/lib/mento-release/`). Only that workflow deploys QA automatically; agents never trigger it unless asked for that run.
2. Web only: root runs `/usr/local/sbin/qa-install-web <tarball.tar.gz>` (verifies the `.sha256`, unpacks to `web-releases/<name>`, atomically flips `web`, saves the old target as `previous-web`).
3. API by hand (new): root runs `ops/build-api.sh <sha>` output to build `mento-api:<shortsha>-r<N>` (never reuses a tag; the commands print the tag), then `qa-deploy-api <shortsha>-r<N>`: backs up and rewrites `ci.override.yml`, migrates through the `api` service with the same image, recreates `api` + `worker`, waits up to 60 s for HTTP 200 on `https://qa-api.mento.chat/api/v1/health/ready`, and rolls back automatically if that fails. Every run appends tag and Alembic revision before/after to `deploy-history.log`.

### Rollback today

- Web: `qa-install-web --rollback` swaps `web` and `previous-web`.
- API: `qa-deploy-api --rollback` restores the tag in `previous-api-tag` (and swaps it, so a second run undoes the first). It changes the image only; **database migrations are not undone**. Expand/contract rules mean the old image must run on the newer schema; `deploy-history.log` shows the revision each tag last ran with.
- Before `qa-deploy-api` existed, the only API path was the receiver's own handling inside the workflow; whether the receiver has a rollback command was not verified.

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
