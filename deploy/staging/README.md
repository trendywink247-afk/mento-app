# VPS staging operations

This is an isolated acceptance environment, not a production release. Application
source lives only in H:\Mento gpt\Mento. API artifact: commit 6e47f7a,
image `mento-api:staging-6e47f7a`, image ID
`sha256:28b42aba7e8c9a5baeb849c1f01b183358584ffdfaedfb329f10c769088aeb3b`.
Web fix source: dc8d17c. See release.json for the installed web archive hash.

## Runtime

VPS B 31.42.125.238, `/opt/mento-staging`, Compose project `mento-staging`.
API loopback 18010; Postgres and Valkey have no published ports. Independent
volumes/network and distinct role secrets/message key. ENV=staging, one API
process, pools 2+2, database max connections 30, push off. Container memory limits:
API 256 MiB, worker 256 MiB, Postgres 256 MiB, Valkey 80 MiB. CPU caps prevent
staging taking the whole host. Sample usage was ~246 MiB total; about 950 MiB
host memory remained available. This is a smoke-test sample, not a load envelope.

Nginx remains the host edge while the legacy sites and monitoring remain present.
Balanced Caddy/blue-green cutover is a later rehearsal, not completed by this
initial deployment. `nginx.conf.template` restricts the app/API to the operator's
verified current public IP plus loopback. Only readiness and the two signed
Stream hooks are publicly reachable. Replace OPERATOR_IP locally before install;
never commit the rendered access configuration. No staging credentials are baked
into the web bundle. An IP change requires an explicit allowlist update via SSH.

Secrets are mode 600 under a mode 700 secrets directory. Compose files and public
web assets contain no private values. `.local/` contains ignored deployment
materials on the workstation; never commit or publish that directory.

The pre-existing development Stream application is currently assigned to staging;
its key was confirmed different from both server applications. Its synchronous
and asynchronous hooks point at staging. Do not run concurrent live local Stream
acceptance against this project: local and staging databases differ. A second
non-production Stream application is needed for simultaneous independent live
chat development; local offline/backend tests remain independent. Production
Stream configuration was not changed.

## Commands (from H repository)

```powershell
ssh -F deploy/ssh.config mento-staging
# On B:
cd /opt/mento-staging
docker compose ps
docker compose exec -T api alembic check
docker compose exec -T api python -m scripts.configure_stream https://staging.mento.chat
docker compose exec -T api python < verify-safety.py
bash restore-drill.sh
```

`verify-safety.py` refuses any ENV except staging. It creates only a synthetic
Stream identity/channel, verifies augmentation and flag deduplication, and removes
the synthetic Stream identity/channel. It does not call helplines or send pushes.
`restore-drill.sh` restores the latest archive inside a network-isolated temporary
Postgres container, upgrades the schema using the tested image, and removes that
container and its anonymous data volume. It never attaches production data to the
staging application. Run it serially, after checking host memory/disk.

## Deployment and rollback

Build API and Expo exports locally/CI. Transfer immutable artifacts over verified
SSH, record their hashes, then run migrations before `docker compose up -d --wait`.
Do not copy local `.env` files into staging. Preserve existing secrets on redeploy.
Do not run the seeder repeatedly: it inserts new mentors each time.

Static releases live under `web-releases/<web SHA>`; the host's `web` symlink selects
the release. Switch it atomically and preserve prior releases for rollback. A web
rollback does not roll back database migrations or Stream message history.
Stopping only staging: `docker compose stop` from `/opt/mento-staging`; never use
legacy project commands or remove volumes as a deployment step.

TLS was issued for staging.mento.chat; Certbot's renewal timer manages renewal.
`renew-nginx.sh` is installed as a deployment hook and was tested with nginx -t
and reload. Certificate renewal itself has not yet occurred.

## Recovery repair and evidence

Production rclone `oldbox` now points to 31.42.125.238 and validates the previously
trusted host key via `/home/mento-ops/.ssh/mento-backup-known-hosts`. The previous
rclone configuration is retained privately beside its config. Both successful
transfer and refusal with an empty trust file were tested.

Fresh archive `mento-20261001-221315.sql.gz` has SHA-256
`368889b6aebffe63d6817cc5735d349a66f6245516e11962df127b3bc5802f2e`
on A and B. Its isolated restore succeeded, then migration from c13a0seen001 to
e5a6part0001 succeeded. The temporary restore data volume was removed.

Existing backups remain gzip SQL archives: encryption at rest, deletion-compatible
retention, separate retention authority and independent backup storage are still
open architecture items. Transport encryption alone does not satisfy these items.

## Remaining promotion gates

Native Android chat/crisis acceptance; staging push with explicitly scoped test
devices; erasure/reconnect/restart/load drills; verified alert delivery; backup
hardening; Caddy/blue-green rehearsal and rollback. Production application release
has not changed. Do not interpret staging availability as production approval.
