# Production cutover runbook

**Status: DRAFT. Never executed.** Written from the production audit and the repo. Nothing in it has been run against the production host. Rehearse the whole thing on QA first (`ops/deploy-api.sh qa`, `infra/caddy/` on `feat/qa-caddy`).

What changes: the API image goes from `mento-api:92b8f57a5cd3` to one built from `origin/main`; the schema goes from `c13a0seen001` to `ea01chat0001`; a **worker** container starts (production has none today); the edge goes from host Nginx to Caddy. What must not change: the database and Redis data, the volumes, the hostnames, the Stream/Razorpay/push configuration.

Two phases, so each can be stopped on its own:

- **Phase A, API:** new image + worker + migrations. Nginx stays the edge and keeps proxying to `127.0.0.1:8000`.
- **Phase B, edge:** Nginx → Caddy. Only after Phase A has soaked.

Run everything as root on the production host. **Never print secrets**: every command below shows setting *names* only. **Never** `docker compose down -v`, `docker volume rm` or `docker system/image prune`.

## 0. Production as audited

| | |
|---|---|
| Host | `129.121.122.28` |
| Edge | host Nginx serving `mento.chat`, `app.`, `api.`, `admin.` |
| Compose (old) | `/opt/mento/deploy/docker-compose.prod.yml` (stays untouched: it is the rollback) |
| Containers | `mento-api-prod` (`mento-api:92b8f57a5cd3`, published on `127.0.0.1:8000`), `mento-postgres-prod`, `mento-redis-prod`. **No worker** |
| Volumes | `mento_pgdata_prod`, `mento_redisdata_prod`, prefixed by the compose project name |
| Schema | `c13a0seen001`. Rehearsal: upgrades cleanly to `ea01chat0001`, zero rows lost |
| Settings | `ENV=prod`, Razorpay keys set, `PUSH_ENABLED=true` |
| Backups | daily to `/opt/mento-backups` (`deploy/backup-postgres.sh`, then an rclone copy off-box) |
| Admin web root | `/opt/mento-console/current` |
| App and apex web roots | **TBD** (found in pre-check P7) |
| Secrets at rest (SOPS vs plain env file) | **TBD** (found in pre-check P3) |

## 1. Prerequisites: merge order

Cutover only starts when all of these are done. `ops/deploy-api.sh prod` refuses an image whose commit is not on `origin/main`, so the last step is enforced in code.

- [ ] #92, then #93, into `dev`
- [ ] QA ops into `dev`: `feat/ops-qa-web`, `feat/ops-qa-api`, `feat/qa-secrets`
- [ ] `feat/ops-prod` (this runbook, `ops/deploy-api.sh`, `deploy/compose.prod-cutover.yml`, `infra/caddy/Caddyfile.prod`) into `dev`
- [ ] `feat/api-compat`, then `feat/sentry`, into `dev`
- [ ] `dev` → `main` PR, **approved by the mentor**, merged
- [ ] The mentor has read this runbook; a window is agreed and announced
- [ ] This runbook was rehearsed on QA end to end, including both rollback levels
- [ ] QA has run the exact release image, with the worker, for at least 24 hours with no job errors (the mentor may extend this)

## 2. Pre-checks (read-only, days before)

**Order of work:** P1, P2; then section 3 steps A1 to A4 (they change nothing users can see); then P2b, P2c, P3, P3b and P4 to P13; then A5 and A6. Several pre-checks need the clone, the image or the override those steps create, and say so.

Keep all evidence in `/root/cutover` (root-only):

```bash
install -d -m 700 /root/cutover
W=/root/cutover
date -u | tee $W/pre-checks-at
```

**P1. Containers and volumes now** (the "before" snapshot you compare against later):

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}' | tee $W/containers-before.txt
docker volume ls --format '{{.Name}}' | sort | tee $W/volumes-before.txt
for v in $(cat $W/volumes-before.txt); do docker volume inspect "$v" --format '{{.Name}} {{.CreatedAt}} {{.Mountpoint}}'; done | tee $W/volumes-before-detail.txt
```

**P2. The compose project name** (the new stack must use exactly this, or it creates *empty* volumes):

```bash
docker inspect mento-api-prod --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}' | tee $W/project.txt
PROJECT=$(cut -d'|' -f1 $W/project.txt)
grep -x "${PROJECT}_mento_pgdata_prod"    $W/volumes-before.txt
grep -x "${PROJECT}_mento_redisdata_prod" $W/volumes-before.txt
```

Both `grep` lines must print a volume name. If either prints nothing, **stop**: the volumes are not named `<project>_mento_*_prod` and the new compose would not reuse them. Fix the compose file (an external `name:`) before going on.

**P2b. How the old stack was actually started (read-only; needed for the Level 2 rollback).** Run this after A1 to A4 (it needs the clone, the override and the compose copy) and before anything else changes. `docker compose config` prints the resolved environment, **passwords included**: never run it bare. Use `--quiet`, `--services`, `--images`, or pipe `--format json` into the comparer, which prints no environment values.

What the repo says about the old start (`deploy/deploy.sh`, legacy stack): from `/opt/mento`, `COMPOSE_FILE=deploy/docker-compose.prod.yml`, `docker compose --env-file "$MENTO_ENV_FILE" ...` with `MENTO_ENV_FILE` exported (the decrypted tmpfs file when `deploy/secrets/prod.env.sops.yaml` exists, else `/opt/mento/services/api/.env`) and `API_TAG` exported (the file defaults to `mento-api:latest` when `API_TAG` is unset), no `-p` (the project name is the compose directory's name unless overridden). The audit's tag `92b8f57a5cd3` is shorter than `deploy.sh`'s 40-hex tags, so **the live containers may have been started another way; do not assume.** Establish it from the containers:

```bash
docker inspect mento-api-prod --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}|{{index .Config.Labels "com.docker.compose.project.config_files"}}|{{index .Config.Labels "com.docker.compose.project.environment_file"}}' | tee $W/old-start-labels.txt
ls -l /opt/mento/services/api/.env /opt/mento/deploy/secrets/prod.env.sops.yaml 2>&1      # metadata only
ls -l /run/user/*/mento/api.env 2>&1                                                      # the tmpfs render, if any
```

Decide `ENVFILE` (the file the live containers were started from; it must also satisfy P3's rules) and `OLD_COMPOSE` (third field of `$W/project.txt`, normally `/opt/mento/deploy/docker-compose.prod.yml`). Check the file really matches the running container (names only):

```bash
OLD_TAG=$(docker inspect mento-api-prod --format '{{.Config.Image}}' | cut -d: -f2); echo "$OLD_TAG"      # must print 92b8f57a5cd3
grep -oE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENVFILE" | tr -d '=' | sort -u | comm -13 - $W/env-names-running.txt | head -50
```

The last command lists names the running container has that the file lacks. Expect only image defaults (`PATH`, `PYTHON_*`, `UVICORN_WORKERS`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `PORT`, `PYTHONUNBUFFERED`, `HOME`-style names) and `DATABASE_URL` / `REDIS_URL` (set by compose). Any application setting listed means the file is not the one the container was started from: find the right one before going on.

Save the verified facts (paths and names only, no secrets); Level 2 rollback reads them:

```bash
printf 'PROJECT=%s\nENVFILE=%s\nOLD_COMPOSE=%s\nOLD_TAG=%s\n' "$PROJECT" "$ENVFILE" "$OLD_COMPOSE" "$OLD_TAG" > $W/vars.sh
chmod 600 $W/vars.sh; . $W/vars.sh
```

Dry-run the exact old start, resolved but not started:

```bash
old_cfg() { MENTO_ENV_FILE="$ENVFILE" API_TAG="$OLD_TAG" docker compose -p "$PROJECT" --env-file "$ENVFILE" -f "$OLD_COMPOSE" "$@"; }
old_cfg config --quiet && echo old-compose-valid
old_cfg config --services          # must list the service names: postgres redis api worker
old_cfg config --images | sort -u  # must include mento-api:92b8f57a5cd3
```

The `api` service name and the resolved image `mento-api:92b8f57a5cd3` are asserted again, mechanically, in P2c. **If the images list shows `mento-api:latest`, `API_TAG` was not honoured: stop and fix the rollback command before the window.**

The Level 2 start command that follows from this. It is written to a file now, so the window uses the verified command and nobody retypes it from memory:

```bash
printf '%s\n' \
  '#!/usr/bin/env bash' \
  '# Start the OLD api image with the OLD compose file, exactly as the live stack was started (P2b).' \
  'set -euo pipefail' \
  '. /root/cutover/vars.sh' \
  'MENTO_ENV_FILE="$ENVFILE" API_TAG="$OLD_TAG" docker compose -p "$PROJECT" --env-file "$ENVFILE" \' \
  '  -f "$OLD_COMPOSE" up -d --no-deps --no-build --wait api' > $W/rollback-level2-start.sh
chmod 700 $W/rollback-level2-start.sh; cat $W/rollback-level2-start.sh
```

`API_TAG` must be set (the old file falls back to `:latest`), `MENTO_ENV_FILE` must be exported (the old file falls back to `../services/api/.env`), and `--no-build` stops compose rebuilding from source. Same shape as `rollback()` in `deploy.sh`.

**P2c. The new compose must adopt the existing containers.** Compose only reuses a container when the project, service name and `container_name` line up. Compare the old and new files for `api`, `postgres` and `redis` (and `worker` where both have one): service names, `container_name`, images, volumes, ports, named volumes. Run after A4 (needs the override):

```bash
new_cfg() { GIT_SHA="$MAIN" docker compose -p "$PROJECT" --env-file "$ENVFILE" -f /opt/mento/compose.prod-cutover.yml -f /opt/mento/prod.override.yml "$@"; }
python3 /opt/mento/src/ops/compare-compose.py --expect-old-image mento-api:92b8f57a5cd3 \
  <(old_cfg config --format json) <(new_cfg config --format json)
```

It prints both sides (names, images, ports only) and ends with `MATCH` (exit 0) or `MISMATCH, STOP` (exit 1) with the differing fields. **Stop if it differs.** Fix `compose.prod-cutover.yml` through a reviewed change on `main`, not by editing the copy on the box. (The same check on the two committed files, with no docker, is `python3 ops/test-compare-compose.py`.)

**P3. Settings: names only, and where the file is.** `ENVFILE` is the file chosen in P2b. It must be a plain file, `root:root 0600`, that survives reboots (not the tmpfs render that `deploy/decrypt-env.sh` rewrites per deploy); if production secrets are SOPS-managed today, the operator makes one stable root-only render. **TBD (audit Mon): how production secrets are held today.**

```bash
docker inspect mento-api-prod --format '{{range .Config.Env}}{{println .}}{{end}}' | cut -d= -f1 | sort -u > $W/env-names-running.txt
wc -l $W/env-names-running.txt
stat -c '%U:%G %a %n' "$ENVFILE"
```

**P3a. Every setting the new code reads.** Each one has a code default, so a missing name never errors by itself: it silently runs on the default. Secrets are listed first. The "refuses to boot" column is `_enforce_prod_invariants` in `app/main.py`: when `ENV` is anything but `dev`, the API **fails fast at startup** if a published-default or missing secret remains (`MESSAGE_KEY` and `DATABASE_URL` are now covered too; see `test_architecture_hardening.py`). The audit found **`MESSAGE_KEY` and `LISTENER_JWT_SECRET` missing from production's running settings**. The old image does not enforce them; the new one does, so it would crash-loop on first start and trigger the automatic rollback. Both are therefore generated *before* the window (A6).

| Setting | Code default | Refuses to boot outside dev? | Production plan |
|---|---|---|---|
| `JWT_SECRET` | published default string | YES: refuses to boot if still the default | carry over |
| `ADMIN_JWT_SECRET` | '' (falls back to JWT_SECRET in dev) | YES: refuses to boot if empty or equal to JWT_SECRET | carry over |
| `LISTENER_JWT_SECRET` | '' | YES: refuses to boot if empty or equal to JWT_SECRET / ADMIN_JWT_SECRET | **NOT in prod today (audit): generate** |
| `MESSAGE_KEY` | '' (dev uses a public key) | YES: refuses to boot if unset, malformed (`<id>:<base64 of 32 bytes>`) or the dev key | **NOT in prod today (audit): generate** |
| `MESSAGE_KEY_PREVIOUS` | '' | YES if set: must parse and not be the dev key | leave empty (no retired keys yet) |
| `DATABASE_URL` | `postgresql+psycopg://mento:mento@localhost:5432/mento` (published password) | YES: refuses to boot if still the default | set by compose from `POSTGRES_PASSWORD` |
| `REDIS_URL` | `redis://localhost:6379/0` | no | set by compose |
| `STREAM_API_KEY` | '' | YES: refuses to boot if empty (crisis scan would be off) | carry over |
| `STREAM_API_SECRET` | '' | YES: refuses to boot if empty | carry over |
| `RAZORPAY_KEY_ID` | '' | no (feature not wired) | carry over |
| `RAZORPAY_KEY_SECRET` | '' | no (feature not wired) | carry over |
| `RECOVERY_RECEIPT_TOKEN` | '' | no | leave unset unless `RECOVERY_RECEIPT_REQUIRED` is turned on |
| `GEMINI_API_KEY` | '' (journal note-sorting stays dark) | no | leave unset |
| `POSTHOG_API_KEY` | '' | no | carry over if set |
| `SENTRY_DSN` | '' (Sentry off) | no | **add** (A6) |

Non-secret settings with a code default (all optional; names that production does not set run on the default):

| Setting | Code default |
|---|---|
| `ENV` | `dev` (`prod` in production; any value other than `dev` turns the boot checks on) |
| `JWT_TTL_DAYS` | `90` |
| `LISTENER_JWT_TTL_DAYS` | `30` |
| `ADMIN_JWT_TTL_DAYS` | `14` |
| `LEGACY_CLAIMS_ACCEPTED_UNTIL` | `2027-01-31` (**cutover must happen on or before 2026-11-02**, otherwise set this later: tokens minted by the old API without `iss/aud/jti` are accepted only until this date) |
| `ACCESS_TOKEN_MINUTES` | `15` |
| `REFRESH_TOKEN_TTL_DAYS` | `90` |
| `MIN_AGE` | `18` |
| `TERMS_VERSION` | `2026-09-27` |
| `TERMS_GATE_ENFORCED` | `False` |
| `RECOVERY_RECEIPT_REQUIRED` | `False` |
| `RECOVERY_RECEIPT_URL` | `''` |
| `DB_POOL_SIZE` | `10` |
| `DB_MAX_OVERFLOW` | `10` |
| `DB_STATEMENT_TIMEOUT_MS` | `5000` |
| `DB_POOL_TIMEOUT` | `5` |
| `DB_POOL_RECYCLE` | `1800` |
| `RATE_LIMIT_ENABLED` | `True` |
| `TRUSTED_PROXY_HOPS` | `0` (**must be set explicitly**: refuses to boot if absent; `1` behind Nginx or Caddy) |
| `PUSH_ENABLED` | `True` (`true` in production) |
| `PUSH_BURST_SECONDS` | `60` |
| `PUSH_WATCH_CACHE_SECONDS` | `5` |
| `CRISIS_SCAN_THREADS` | `8` |
| `PII_REDACTION_ENABLED` | `True` |
| `PII_USE_PRESIDIO` | `True` |
| `STREAM_TIMEOUT_SECONDS` | `3.0` |
| `MESSAGE_RETENTION_DAYS` | `None` (unset = the worker drops nothing; founder decision) |
| `CHAT_FRAMES_PER_WINDOW` | `40` |
| `CHAT_FRAMES_WINDOW_S` | `10` |
| `CHAT_IDLE_DEADLINE_S` | `75.0` |
| `ALLOWANCE_ENABLED` | `True` |
| `ALLOWANCE_ENFORCED` | `False` |
| `ALLOWANCE_IN_A_ROW` | `3` |
| `ALLOWANCE_PER_DAY` | `10` |
| `ALLOWANCE_CRISIS_EXEMPT_HOURS` | `24` |
| `ALLOWANCE_BUDGET_MS` | `800` |
| `MENTOR_NAME_ROTATION_ENABLED` | `True` |
| `IN_TOUCH_LIMIT` | `2` |
| `IN_TOUCH_REASK_DAYS` | `7` |
| `CONVERSATION_MAX_AGE_HOURS` | `24` |
| `SNOOZE_HOURS` | `24` |
| `APP_BASE_URL` | `''` (refuses to boot if the derived CORS origin list is empty) |
| `ADMIN_BASE_URL` | `''` (refuses to boot if the derived CORS origin list is empty) |
| `CONSOLE_BASE_URL` | `http://localhost:8081` |
| `CORS_ORIGINS` | `''` (refuses to boot if the derived CORS origin list is empty) |
| `POSTHOG_HOST` | `https://app.posthog.com` |
| `GEMINI_MODEL` | `gemini-1.5-flash` |
| `CRISIS_HELPLINES_JSON` | `Tele-MANAS 14416 and 1800-89-14416 (JSON)` |

Read outside `Settings`: `UVICORN_WORKERS` (2), `PORT` (8000) in the image; `GIT_SHA` (empty) is supplied by `deploy-api`, never by the env file.

**P3b. What production is missing** (needs the image from A3; A1 to A3 do not affect users, so do them first):

```bash
docker run --rm mento-api:$TAG python -c "from app.config import Settings; print('\n'.join(sorted(n.upper() for n in Settings.model_fields)))" > $W/env-names-code.txt
comm -13 $W/env-names-running.txt $W/env-names-code.txt        # read by the code, not set in production
```

Walk the output against the table. Every **secret** that appears is missing and must exist before the window; every non-secret simply runs on its default (decide for each whether that is acceptable). Also check (names only):

```bash
grep -x -e MESSAGE_RETENTION_DAYS -e PUSH_ENABLED -e ENV -e TRUSTED_PROXY_HOPS -e STREAM_API_KEY -e STREAM_API_SECRET -e RAZORPAY_KEY_ID -e RAZORPAY_KEY_SECRET $W/env-names-running.txt
```

**`MESSAGE_RETENTION_DAYS`:** unset means nothing is ever dropped. The worker's daily job *drops* message partitions older than that many days. If the name is present, confirm the value with the founder before the worker starts. Otherwise leave it unset.

**P4. Migrations between `c13a0seen001` and head are expand-only?** The old image keeps serving for a few seconds on the new schema. After A3 builds the image:

```bash
docker run --rm mento-api:$TAG alembic history -r c13a0seen001:head
grep -nE 'drop_(table|column|index|constraint)|alter_column|rename_table|rename_column' /opt/mento/src/services/api/migrations/versions/*.py
```

Read every hit that belongs to a revision in that range. Anything that removes or retypes something the old image reads blocks the cutover (expand/contract rule). One known case: `e5a6part0001` replaces the never-deployed T5.1 `chat_messages` table; confirm it is empty or absent in production.

**P5. Row counts, baseline:**

```bash
rowcounts() {
  docker exec mento-postgres-prod psql -X -U mento -d mento -At -c \
    "select format('select %L, count(*) from public.%I', tablename, tablename) from pg_tables where schemaname='public' order by tablename" \
  | docker exec -i mento-postgres-prod psql -X -U mento -d mento -At
}
rowcounts | tee $W/rowcounts-before.txt
docker exec mento-api-prod alembic current | tee $W/alembic-before.txt        # expect c13a0seen001
```

**P6. Health and crisis baseline:**

```bash
for p in ready crisis; do echo "== $p"; curl -s -w '\nhttp=%{http_code}\n' http://127.0.0.1:8000/api/v1/health/$p; done | tee $W/health-before.txt
```

`crisis` is 200 only while a Stream webhook has arrived in the last 30 minutes (`STALE_AFTER`); 503 `stale` is normal on a quiet night. Record `last_webhook_at`; it is compared after the cutover (it lives in Redis).

**P7. Nginx: roots and the apex.** This discovers the TBDs:

```bash
nginx -T 2>/dev/null > $W/nginx-T.txt
grep -E 'server_name|root ' $W/nginx-T.txt
tar czf $W/etc-nginx.tgz /etc/nginx && chmod 600 $W/etc-nginx.tgz
```

From that output record: the **app** web root (`app.mento.chat`) → `APP_WEB_ROOT`; what the **apex** `mento.chat` does (redirect only, or content). `infra/caddy/Caddyfile.prod` assumes the apex redirects to `app.` and `/admin*` to `admin.`; if the apex serves content, edit the file before cutover. **TBD (audit Mon): app root, apex behaviour.** Confirm the admin root is `/opt/mento-console/current` and is a symlink.

**P8. Certificates, ports, timers:**

```bash
ss -ltnp | grep -E ':(80|443|8000) '
ls /etc/letsencrypt/live
systemctl list-timers --all | grep -i certbot
```

Caddy gets its own certificates over ACME when it takes port 80/443. Let's Encrypt rate limits make repeated Nginx↔Caddy flips risky; do not flip more than needed.

**P9. Caddy installed (do not let it start):**

```bash
caddy version || echo "not installed"
```

If missing or the old Ubuntu 2.6.x package, install the upstream build following `infra/caddy/RUNBOOK.md` step 1 (on `feat/qa-caddy`), then **immediately** `systemctl disable --now caddy` so it cannot fight Nginx for port 80.

**P10. Headroom.** The cutover stack is capped at postgres 256 MB + redis 128 MB + api 384 MB + worker 256 MB = 1 GB, plus Caddy:

```bash
free -m; df -h /opt /var/lib/docker
```

Need free memory for the worker (256 MB) and at least 8 GiB free disk (image build, backups).

**P11. The backup step works, including the off-box copy.** `deploy-api.sh prod` runs the backup script and aborts if it fails, and that script fails when the rclone copy fails (`oldbox` was 31.42.125.238; see STATUS). Prove it now:

```bash
/opt/mento/deploy/backup-postgres.sh && ls -lt /opt/mento-backups | head -3
```

Exit 0 is required. If it fails, fix the off-box remote *before* the window. Do not edit the script during the window.

**P12. The rollback image survives.** `docker image inspect mento-api:92b8f57a5cd3 >/dev/null && echo present`. Never run an image prune.

**P13. Decisions to take before the window:**

- Robots header, **decided**: `X-Robots-Tag: noindex, nofollow` is OFF for `mento.chat` and `app.mento.chat`, and ON for `api.mento.chat` and `admin.mento.chat` (`infra/caddy/Caddyfile.prod`: the `noindex` snippet is imported by those two hosts only).
- Apex behaviour (P7).
- The off-peak window, and who is on call for Stream and push.

## 3. Prepare (no user impact)

**A1. Root-owned clone, fetched over https (the repo is public; no credentials on this host):**

```bash
git clone https://github.com/trendywink247-afk/mento-app.git /opt/mento/src
git -C /opt/mento/src fetch origin main
MAIN=$(git -C /opt/mento/src rev-parse origin/main); echo $MAIN | tee $W/main-sha
git -C /opt/mento/src log -1 --format='%H %s' origin/main
test -f /opt/mento/src/ops/deploy-api.sh -a -f /opt/mento/src/deploy/compose.prod-cutover.yml -a -f /opt/mento/src/infra/caddy/Caddyfile.prod && echo files-present
```

`$MAIN` must be the merge commit of the mentor-approved `dev` → `main` PR. If not, stop. (`/opt/mento` is also the old checkout that `deploy.sh` resets; `src/` inside it is untracked and untouched by `git reset --hard`. Do not run `git clean` there.)

**A2. Install the deploy script and the compose file:**

```bash
install -o root -g root -m 755 /opt/mento/src/ops/deploy-api.sh /usr/local/sbin/deploy-api
install -o root -g root -m 644 /opt/mento/src/deploy/compose.prod-cutover.yml /opt/mento/compose.prod-cutover.yml
sha256sum /usr/local/sbin/deploy-api /opt/mento/src/ops/deploy-api.sh      # the two must match
```

**A3. Build ON this host (no image transfer between servers).** The clone is root-owned, so git runs directly:

```bash
BUILD_GIT_USER= /opt/mento/src/ops/build-api.sh $MAIN | bash
```

The output ends `built mento-api:<shortsha>-r<N>`. A tag is never reused; a rebuild gets `-r2`. Record it and check the label:

```bash
TAG=${MAIN:0:12}-r1          # use the N the build printed
docker image inspect mento-api:$TAG --format '{{index .Config.Labels "org.opencontainers.image.revision"}} {{.Id}}' | tee $W/image.txt
```

The label must equal `$MAIN`. Now run P4 (migration review) with this image.

**A4. `deploy.conf` and the first override.** `deploy.conf` is sourced as root by `deploy-api`; it must be root-owned and not group/world writable.

```bash
ENVFILE=<path chosen in P2b>
cat > /opt/mento/deploy.conf <<EOF
PROJECT=$PROJECT
MENTO_ENV_FILE=$ENVFILE
NO_WORKER_TAGS="92b8f57a5cd3"
EOF
chown root:root /opt/mento/deploy.conf; chmod 600 /opt/mento/deploy.conf

cat > /opt/mento/prod.override.yml <<'YML'
services:
  api:
    image: mento-api:92b8f57a5cd3
  worker:
    image: mento-api:92b8f57a5cd3
YML
chmod 644 /opt/mento/prod.override.yml
```

The override starts on the **old** tag (what is live) so the first deploy records it as `previous-api-tag`. `NO_WORKER_TAGS` stops a rollback to that image from starting a worker it cannot run.

**A5. Dry validate the compose pair (no containers touched):**

```bash
GIT_SHA=$MAIN docker compose -p "$PROJECT" --env-file "$ENVFILE" \
  -f /opt/mento/compose.prod-cutover.yml -f /opt/mento/prod.override.yml config -q && echo compose-ok
```

**A6. Settings: carry over, generate, add, never set.** Do this before the window; it changes only the env file, which the running (old) containers do not re-read until they are recreated. Take the safety copy first:

```bash
. $W/vars.sh
cp -p "$ENVFILE" $W/api.env.pre-cutover        # secret file in a root-only dir; delete after the rollback window
```

*Carry over unchanged* (already in production's running settings; edit nothing): `ENV=prod`; `JWT_SECRET` and `ADMIN_JWT_SECRET` (**never regenerate these**: a new `JWT_SECRET` signs everyone out, a new `ADMIN_JWT_SECRET` invalidates admin sessions); `STREAM_API_KEY` / `STREAM_API_SECRET`; `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`; `PUSH_ENABLED=true` and the push credentials; `APP_BASE_URL`, `ADMIN_BASE_URL`, `CORS_ORIGINS`; `TRUSTED_PROXY_HOPS` (Caddy is one proxy hop, same as Nginx; verify it is set, the new image refuses to boot without it); `UVICORN_WORKERS`, `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`; `POSTGRES_PASSWORD` (compose reads it through `--env-file`). `STREAM_*` and `RAZORPAY_*` are issued by the vendors: if either is missing, stop and get it from the team password manager; it cannot be generated.

*Generate new, on the box, before the window* (the audit shows these are **not** in production's running settings; the new image refuses to boot without them):

| Name | Value |
|---|---|
| `LISTENER_JWT_SECRET` | `secrets.token_urlsafe(48)`, distinct from `JWT_SECRET` and `ADMIN_JWT_SECRET` by construction |
| `MESSAGE_KEY` | `<key id>:<base64 of 32 random bytes>` from the module's own generator (`python -m app.services.message_crypto k1`). **Not** a `token_urlsafe` string: the API rejects anything that is not this shape |

Plus **any other secret** that P3b showed as missing and that can be generated (`JWT_SECRET` / `ADMIN_JWT_SECRET` are never in this list; vendor keys are never generated). The value is produced inside the image, piped straight into the file, and never printed, logged or put in a shell variable:

```bash
has_env() { grep -q "^$1=" "$ENVFILE"; }
append_env() {   # append_env NAME  (the value arrives on stdin)
  [ -z "$(tail -c1 "$ENVFILE")" ] || echo >> "$ENVFILE"      # make sure the file ends with a newline
  { printf '%s=' "$1"; cat; } >> "$ENVFILE"
}
has_env LISTENER_JWT_SECRET || docker run --rm mento-api:$TAG python -c 'import secrets;print(secrets.token_urlsafe(48))' | append_env LISTENER_JWT_SECRET
has_env MESSAGE_KEY         || docker run --rm mento-api:$TAG python -m app.services.message_crypto k1 | append_env MESSAGE_KEY
for n in LISTENER_JWT_SECRET MESSAGE_KEY; do printf '%s: %s line(s)\n' "$n" "$(grep -c "^$n=" "$ENVFILE")"; done     # 1 each
stat -c '%U:%G %a %n' "$ENVFILE"                                                                                  # root:root 600
```

`has_env` makes this safe to re-run: an existing value is never overwritten. (Overwriting `MESSAGE_KEY` after chats exist would make stored messages unreadable.)

*Add:*

- **`SENTRY_DSN`**: the production project's DSN from the team password manager. With `ENV=prod` the code reports as environment `production` (`feat/sentry` maps `qa`/`staging` → `qa` and `prod`/`production` → `production`; anything else is off), so there is no separate environment setting to add. Enter it without echo:

  ```bash
  has_env SENTRY_DSN || { read -rsp 'SENTRY_DSN: ' V; echo; printf '%s' "$V" | append_env SENTRY_DSN; echo >> "$ENVFILE"; unset V; }
  ```

- **`GIT_SHA`**: do **not** put it in the env file. `deploy-api` exports the full commit from the image label on every deploy; compose passes it to `api` and `worker` as the Sentry release. A hand-written value would be overridden.
- Anything else P3b flagged and you decided to set.

*Set by compose, ignore in the file:* `DATABASE_URL`, `REDIS_URL`.

Never set `MESSAGE_RETENTION_DAYS` in this change unless the founder has chosen the number.

**A6b. Escrow the message key (a human step, the only place a secret is ever shown).** Production has no encrypted messages yet (the T5.1 table was never deployed), so nothing is unreadable today. From the first chat message onward, **losing `MESSAGE_KEY` makes every stored message permanently unreadable**, and the pre-cutover env copy and the Level 2 backup do not contain it. Before the window, the operator (with the mentor's agreement) puts the value in the team password manager from the box console, and clears the terminal scrollback afterwards. Tooling, tickets and chat never see it. `LISTENER_JWT_SECRET` needs no escrow: it can be regenerated (`scripts/issue_listener_token` reissues mentor links; tokens signed with `JWT_SECRET` stay accepted until `LEGACY_CLAIMS_ACCEPTED_UNTIL`).

**A6c. Prove the new image will boot with this file** (the same checks the API runs at startup, offline, nothing started). `DATABASE_URL` is a placeholder here because compose supplies the real one:

```bash
docker run --rm --env-file "$ENVFILE" -e DATABASE_URL='postgresql+psycopg://check:check@db:5432/mento' mento-api:$TAG \
  python -c "from app import main; main._enforce_prod_invariants(); print('boot invariants OK')"
```

`boot invariants OK` is required. Otherwise it prints `RuntimeError: unsafe prod configuration: ...` naming every offending setting (names only, never values); fix them all and re-run. Note `docker run --env-file` does not strip quotes; a quoted value in the file will fail here even though compose would accept it: fix the file, not the check.

## 4. Phase A: API, worker and migrations (Nginx still the edge)

**A7. Announce the window.** Take the on-call people out of "waiting".

**A8. Deploy.**

```bash
deploy-api prod $TAG
```

What it does, in order, stopping at the first failure with nothing changed: checks the image exists; checks its commit label matches the tag and is an ancestor of `origin/main` in `/opt/mento/src` after a fetch; takes `/opt/mento/deploy.lock`; asks you to type `deploy prod <tag>`; **takes a fresh backup in this run** (must be new, non-empty, under 15 minutes old, pass `gzip -t`; prints its sha256); records the schema revision; backs up and rewrites `prod.override.yml`; runs `alembic upgrade head` through the real `api` service with the new image; recreates `api` and starts `worker`; waits up to 60 s for HTTP 200 on `http://127.0.0.1:8000/api/v1/health/ready` from the *new* container; on failure rolls back the image automatically and exits non-zero.

Write down: the backup file, its **sha256**, `rev_before`, `rev_after`, and the tag. They are in `/opt/mento/deploy-history.log`:

```bash
tail -n 3 /opt/mento/deploy-history.log | tee $W/deploy-history-tail.txt
```

Interpretation: `result=ok` and `rev_after=ea01chat0001` → continue. `failed-migrate` → nothing was restarted; read the error, the DB is at `rev_after`. `failed-rolled-back` → the old image is serving again, the **schema was not undone**.

**A9. Verify the API.**

```bash
docker ps --format '{{.Names}}\t{{.Image}}\t{{.Status}}'
docker exec mento-api-prod alembic current | tee $W/alembic-after.txt                       # ea01chat0001
curl -s -o /dev/null -w 'ready=%{http_code}\n' http://127.0.0.1:8000/api/v1/health/ready
docker inspect -f '{{.State.Running}}' mento-worker-prod                                    # true
docker logs --tail 40 mento-worker-prod 2>&1 | grep -iE 'error|traceback' || echo "worker log: no errors"
docker exec mento-postgres-prod psql -X -U mento -d mento -Atc "select to_regclass('public.procrastinate_jobs') is not null"   # t
docker exec mento-postgres-prod psql -X -U mento -d mento -Atc "select count(*) from pg_inherits i join pg_class c on c.oid=i.inhparent where c.relname='chat_messages'"   # partitions
curl -sI https://api.mento.chat/api/v1/health/ready | head -1                                # still through Nginx
```

**A10. Volumes and data: before and after.**

```bash
docker volume ls --format '{{.Name}}' | sort > $W/volumes-after.txt
diff $W/volumes-before.txt $W/volumes-after.txt && echo "volumes identical"
for v in $(cat $W/volumes-after.txt); do docker volume inspect "$v" --format '{{.Name}} {{.CreatedAt}} {{.Mountpoint}}'; done > $W/volumes-after-detail.txt
diff $W/volumes-before-detail.txt $W/volumes-after-detail.txt && echo "volume details identical (same creation times)"
rowcounts > $W/rowcounts-after.txt
diff $W/rowcounts-before.txt $W/rowcounts-after.txt
```

The volume diffs must be empty. If a new `*_mento_pgdata_prod` or `*_mento_redisdata_prod` volume appeared, the project name was wrong: **stop, go to rollback level 2.** The row-count diff may show *increases* (live traffic) and *new tables*; **no table may have fewer rows.**

**A11. Crisis scan check (T&S; the crisis hook must work before anything else is trusted).**

1. Webhook liveness survived the restart (Redis data retained):
   ```bash
   curl -s -w '\nhttp=%{http_code}\n' http://127.0.0.1:8000/api/v1/health/crisis | tee $W/crisis-after.txt
   ```
   Compare `last_webhook_at` with `$W/health-before.txt`; it must be the same or newer. `ok`/200 is expected within 30 minutes of real traffic; `stale`/503 on a quiet system is not itself a failure, but then do step 3.
2. Stream still reaches this API (host unchanged, so no dashboard change is expected). An unsigned request must be rejected by the application, not time out or 404:
   ```bash
   for p in stream/webhook stream/before-message-send; do curl -s -o /dev/null -w "$p http=%{http_code}\n" -X POST https://api.mento.chat/api/v1/$p; done
   ```
   Expect a 4xx signature rejection (not 404, 502 or a timeout). Also confirm in the Stream dashboard that both hook URLs still read `https://api.mento.chat/api/v1/stream/...` and that the last delivery succeeded.
3. End to end: with the test member and test mentor accounts, send a test message through the live app that the crisis scan is designed to flag, and confirm the flag appears in the admin console and `last_webhook_at` advances. **TBD: the approved production test procedure and phrase come from the T&S owner; they are not reproduced here.** `deploy/staging/verify-safety.py` refuses to run outside staging and must not be pointed at production.

Do not continue to Phase B until all three pass. If the crisis scan is not working, roll back (level 1 first).

**A12. Razorpay: what can and cannot be tested.** At this commit **payments are not wired in the API**: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` exist as settings and the `contributions` table has `razorpay_order_id` / `razorpay_payment_id` columns, but there is no checkout or webhook endpoint, `apps/mobile/app/coffee.tsx` says payments are not live, and `admin_console.py` notes "Razorpay not wired yet". So a **test payment cannot be run in this release**. What to check instead:

```bash
grep -x -e RAZORPAY_KEY_ID -e RAZORPAY_KEY_SECRET $W/env-names-running.txt          # still configured, names only
```

- The coffee screen still says payments are not live (so nobody can pay into a flow that does not exist).
- The admin Contributions panel loads and shows the same rows as before (`contributions` count unchanged in `rowcounts`).

If the release is expected to take a real Razorpay test payment, **that code is not in this build**; stop and raise it before the window.

**A13. Soak.** Watch 15–30 minutes: `docker logs -f --tail 20 mento-api-prod` (look for errors only), the Sentry project (first events carry release = the full `$MAIN`), the worker's periodic jobs (`prune-jobs`, `capacity`, `chat-partitions`), and the monitors. This is a safe place to stop. Nginx is still the edge and nothing else has changed.

## 5. Phase B: edge, Nginx → Caddy

Only after Phase A has soaked clean.

**B1. Render and validate the Caddyfile:**

```bash
APP_WEB_ROOT=<from P7>
sed "s#__APP_WEB_ROOT__#${APP_WEB_ROOT}#" /opt/mento/src/infra/caddy/Caddyfile.prod > /root/cutover/Caddyfile.rendered
grep -n '__APP_WEB_ROOT__' /root/cutover/Caddyfile.rendered && echo "STOP: unrendered placeholder" || echo rendered
test -d "$APP_WEB_ROOT" && test -d /opt/mento-console/current && echo roots-exist
caddy validate --config /root/cutover/Caddyfile.rendered --adapter caddyfile
```

**B2. Install the Caddyfile (Nginx still running):**

```bash
cp -a /etc/caddy/Caddyfile /etc/caddy/Caddyfile.pre-cutover 2>/dev/null || true
install -o root -g caddy -m 640 /root/cutover/Caddyfile.rendered /etc/caddy/Caddyfile
```

**B3. Swap the edge.** Downtime is the few seconds between stopping Nginx and Caddy answering; DNS already points here, so Caddy issues its certificates on first start.

```bash
nginx -t
systemctl stop nginx && systemctl start caddy
```

Within 10 seconds:

```bash
systemctl is-active caddy
for h in api app admin; do curl -s -o /dev/null -w "$h http=%{http_code}\n" https://$h.mento.chat/; done
curl -s -o /dev/null -w 'ready=%{http_code}\n' https://api.mento.chat/api/v1/health/ready
```

**If Caddy is not serving within 60 seconds, flip back at once:** `systemctl stop caddy && systemctl start nginx` (rollback level 3a). Nothing else has changed.

**B4. Make it stick** (only once B3 is verified):

```bash
systemctl enable caddy
systemctl disable nginx                      # not removed: it is the rollback
systemctl disable --now certbot.timer 2>/dev/null || true
```

Without this a reboot lets Nginx grab port 80 first.

**B5. Verify from the public internet** (an operator laptop, not this host):

- `https://api.mento.chat/api/v1/health/ready` → 200; certificate issued by Let's Encrypt, valid.
- `https://app.mento.chat/` loads the app; a deep link such as `/some/route` returns the SPA, a missing `/assets/x` is a real 404; `/admin` on the app host is 404.
- `https://admin.mento.chat/` → 302 to `/admin`; the dashboard logs in; a non-admin path is 404.
- `https://mento.chat/` → redirects to `app.`; `/admin…` → redirects to `admin.`.
- Response headers on all four hosts carry `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and no `Server`. `X-Robots-Tag: noindex, nofollow` is present on `api.` and `admin.` and **absent** on `mento.chat` and `app.` (`curl -sI https://<host>/ | grep -i x-robots-tag`).
- A real chat opens (WebSocket through Caddy), a message sends, a push arrives on a test device.
- Re-run A11 (all three) against the public hostname.
- The external monitor (`external-monitor.sh` / Uptime Kuma) shows green and its alert path still fires (they poll `https://api.mento.chat/api/v1/health/crisis`).

**B6. Close out:** `deploy-history.log` and `$W` are the record. Update `docs/environments.md` (production section: replace TBDs with the audited facts), the `CLAUDE.md` environments table, and `docs/STATUS.md`. Delete `$W/api.env.pre-cutover` after the rollback window (suggest 14 days).

## 6. Rollback

Pick the lowest level that fixes the problem. Data written after the cutover exists only in the live database; restoring a backup (level 2) throws it away. Decide that with the mentor, not alone.

**Level 1: API only (image swap).** Use when the new code misbehaves and the schema is fine for the old image (expand-only, per P4):

```bash
deploy-api prod --rollback
```

It asks you to type `rollback prod <tag>`, puts the previous image back (api only; the worker is stopped because that image has none), waits for health, and logs it. **It does not undo migrations and does not restore the database**; it prints the schema revision the old tag last ran with next to the current one.

**Level 2: full rollback: restore the pre-cutover backup + old image + Nginx.** Use when data or schema is damaged, or the volumes were wrong. This **loses everything written since the backup.**

1. Take a forensic dump of the current state first:
   ```bash
   docker exec mento-postgres-prod pg_dump -U mento mento | gzip > /opt/mento-backups/incident-$(date +%Y%m%d-%H%M%S).sql.gz
   ```
2. Edge back to Nginx (skip if Phase B never ran):
   ```bash
   systemctl stop caddy && systemctl disable caddy
   systemctl enable --now nginx
   ```
   (Nginx's configuration was never touched; `$W/etc-nginx.tgz` is the copy if it was.)
3. Stop the new application containers (not Postgres or Redis):
   ```bash
   docker stop mento-api-prod mento-worker-prod
   docker rm mento-worker-prod
   ```
4. Find and verify the backup named in `deploy-history.log` (the `backup=` and `sha256=` fields of the cutover line):
   ```bash
   grep ' action=deploy ' /opt/mento/deploy-history.log | tail -n 3
   B=/opt/mento-backups/<backup file from the log>
   sha256sum "$B"              # must equal the logged sha256
   gzip -t "$B" && echo gzip-ok
   ```
5. Restore into a **new** database, then swap names. The failed database is kept for forensics; nothing is dropped:
   ```bash
   P="docker exec -i mento-postgres-prod psql -X -U mento -v ON_ERROR_STOP=1"
   $P -d postgres -c "CREATE DATABASE mento_restore OWNER mento"
   gunzip -c "$B" | $P -d mento_restore --single-transaction
   $P -d mento_restore -Atc "select version_num from alembic_version"          # c13a0seen001
   $P -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='mento' and pid<>pg_backend_pid()"
   $P -d postgres -c "ALTER DATABASE mento RENAME TO mento_failed_$(date +%Y%m%d%H%M)"
   $P -d postgres -c "ALTER DATABASE mento_restore RENAME TO mento"
   ```
6. Start the OLD image with the OLD compose file (`docker-compose.prod.yml` is untouched), using the command verified in P2b and saved then; do not retype it:
   ```bash
   /root/cutover/rollback-level2-start.sh
   ```
   It runs `MENTO_ENV_FILE="$ENVFILE" API_TAG="$OLD_TAG" docker compose -p "$PROJECT" --env-file "$ENVFILE" -f "$OLD_COMPOSE" up -d --no-deps --no-build --wait api`, with the project, env file and compose file recorded from the live containers in P2b (`/root/cutover/vars.sh`). `API_TAG` is required because the old file otherwise starts `mento-api:latest`; `MENTO_ENV_FILE` is required because the old file otherwise reads `../services/api/.env`. The service is named `api` (asserted in P2c) and compose adopts `mento-api-prod` because the project and `container_name` match (also P2c).
   Then `docker exec mento-api-prod alembic current` → `c13a0seen001`, `curl http://127.0.0.1:8000/api/v1/health/ready` → 200, and the public hostnames answer through Nginx.
7. Confirm the volumes list equals `$W/volumes-before.txt`, and row counts are close to `$W/rowcounts-before.txt` (lower only by what was written during the window). The extra settings (`SENTRY_DSN`) are harmless to the old image; `$W/api.env.pre-cutover` is the exact previous file if you want it back.
8. Record what happened and why; do not retry the cutover until the cause is understood.

**Level 3a: edge only.** Caddy misbehaves, everything else is fine: `systemctl stop caddy && systemctl start nginx` (then `systemctl enable nginx && systemctl disable caddy` if it is to stay). No data is touched.

Never use `docker compose down -v`, `docker volume rm` or an image prune at any level.

## 7. After the cutover

- The `chat_messages` partitions: the migration creates the current month plus two, and the worker's daily `chat-partitions` job keeps two ahead. **Follow-up:** check they exist beyond 2026-12 once the worker has run (see `docs/STATUS.md`).
- The old `docker-compose.prod.yml`, the Nginx config and the pre-cutover env/backups stay for the rollback window (suggest 14 days), then clean up with the mentor's approval.
- Retire `/opt/mento/src` clone handling into the normal release flow only after the next deploy has been done the same way once.
