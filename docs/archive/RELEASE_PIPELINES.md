# Test, staging and production delivery

## Contract

Work only in `H:\Mento gpt\Mento`. Development is local; VPS B
(`31.42.125.238`) hosts isolated staging and monitoring; VPS A
(`129.121.122.28`) hosts production. These two machines are an initial deployment
foundation, not a claim of nationwide capacity or high availability.

PRs run API CI (lint, real Postgres tests and migration checks), Test CI
(TypeScript, mobile unit checks, exported-web age gate in normal/reduced motion,
release-policy tests and workflow syntax), and Maestro when application/native
files change. Every master push runs API, Test CI and Maestro. The release gate
requires successful named jobs for the **exact SHA**, from a master push; missing,
skipped, failed, cancelled and stale runs are rejected. An earlier successful
attempt cannot hide a newer failed attempt. Crisis acceptance runs on staging
where Stream can reach the signed webhook, not on the CI runner's localhost.

The old automatic Console Deploy and independent API Deploy workflows are removed
by this PR. Both are also disabled in GitHub now, so merging the dependency PRs
cannot trigger their old production bypass before this PR lands.

## Staging Release

Dispatch on **master** with a full SHA already green on master. The workflow:

1. Validates exact-commit test evidence and master ancestry.
2. Builds one SHA-labelled API image and two web configurations (staging and
   production URLs/Stream keys). Records image identity and SHA-256 checksums.
3. Uploads the candidate to the staging-only forced-command receiver. It rejects
   unsafe archives, changed candidates, incorrect checksums and low disk space.
   The API archive checksum is the portable identity. The receiver checks its
   sole image tag/source label and records the loaded host's native image ID;
   Docker classic and containerd image stores need not expose the same build ID.
4. Takes a pre-migration staging backup, migrates once, starts API/worker on the
   same image, then switches the web symlink. On failure it restores the prior
   image configuration and web pointer. Schema downgrades are never automatic.
5. Checks migration drift, live signed Stream safety and isolated backup restore.
6. Opens a pinned SSH tunnel to loopback HTTPS; public staging stays restricted.
   Creates a temporary synthetic mentor and temporarily reserves staging matching
   for the test. Runs age gate, recovery and two-party chat in both motion modes.
   The test selects its actual conversation, not the first inbox row.
7. Restores the prior mentor availability and suspends the temporary credential.
   The fixture snapshot is persisted before changing availability. If a runner is
   forcibly terminated, run `cleanup <SHA>` through the staging CI identity before
   another fixture; the next fixture fails closed while recovery is outstanding.
8. Rechecks the running image/commit and publishes the accepted candidate artifact
   for 14 days. A failing acceptance step publishes no promotable artifact.

The separate `built-candidate` artifact is saved before deployment. For a failed
or interrupted deployment, redispatch with `reuse_build_run_id` set to that
completed staging run. This reuses identical bytes and avoids mutating an existing
candidate. Production accepts only `release-candidate` from a successful staging
run; a successful build alone is not acceptance. Expired artifacts require a new
candidate commit/build, not overwriting a previously received candidate.

Staging is exclusively reserved during acceptance. Existing chats and capacity
counters are preserved. Synthetic account/chat retention needs a scheduled policy;
the fixture does not erase unrelated staging data.

## Production Release

Dispatch on **master** with the full SHA and successful Staging Release run ID.
The workflow verifies the staging workflow's identity, branch, result, required
job and artifact manifest, then revalidates current exact-SHA CI evidence.
Production consumes that run's API image and production web export **without a
rebuild**. Environment-specific web outputs necessarily differ; both are built
from the same source during staging. Runtime production web smoke checks follow
promotion; iOS/App Store distribution remains a separate release track.

`PRODUCTION_RELEASE_ENABLED` in the production environment is currently `false`.
It must stay false until the checklist below is completed. This is a fail-closed
operational switch, not a substitute for protected branches or an independent
approval. There are currently no GitHub environment review rules. GitHub's API
reported that branch protection for this private repository requires a plan
upgrade; do not make the repository public to bypass that limitation.

## Credentials and server installation

Staging uses the dedicated `mento-ci-staging` account. `deploy/install-ci-staging.sh`
installs reviewed, root-owned scripts outside the application checkout, an exact
sudo command, and an SSH Match block. Shell commands are forced through the
receiver; only local forwarding to `127.0.0.1:443` is allowed. Remote forwarding,
PTY, agent forwarding and password login are disabled. The current private key is
local under ignored `.local/`; never commit it. Host keys are pinned, never
discovered with `ssh-keyscan` during deployment.

Configured staging environment secrets: `STAGING_DEPLOY_SSH_KEY`,
`STAGING_DEPLOY_KNOWN_HOSTS`, `STAGING_STREAM_API_KEY`. Existing repository secret
`MOBILE_ENV_PRODUCTION` supplies public production web configuration. Browser
mentor tokens are generated per acceptance and masked, not stored as persistent
GitHub secrets.

Production still requires `PRODUCTION_DEPLOY_SSH_KEY` and
`PRODUCTION_DEPLOY_KNOWN_HOSTS`, an equivalently restricted production receiver
installation, and conversion of `/opt/mento-console/current` from the legacy
directory to a release symlink with an immediate rollback target. The receiver
deliberately refuses to perform that filesystem migration during a release.
No production identity or receiver has been activated by this change.

## Activation and release checklist

`deploy/encrypt-backup.sh SOURCE.sql.gz PUBLIC_RECIPIENTS NEW_ARCHIVE.age`
is a preparation utility, not the scheduled backup pipeline. It validates the
gzip source, encrypts with age, publishes a private archive without overwriting
an existing destination, and retains the source. Synthetic round-trip and failure
tests run in CI. No real backup encryption or key custody is implied by these tests.
Before activation: establish recoverable private-key custody outside both VPSes,
install only public recipients on A, prove authorized restore, exclude message
bodies as required by the architecture book, and approve deletion-compatible
retention. Do not remove existing plaintext backups until that migration is
explicitly authorized and recovery has been proven.

On an authorized recovery host, `deploy/decrypt-backup.sh ARCHIVE.age IDENTITY
NEW.sql.gz` fully authenticates/decrypts and validates gzip before publishing a
private recovery file. It refuses overwrite and removes partial output on errors.
It never imports SQL. Tests reject a wrong identity, truncated ciphertext and a
decryptable non-gzip payload. A successful decryption is not evidence of database
restore or application recovery; those require separate isolated validation.

Worker deployment now waits for the actual `app.jobs.worker` process and a fresh
queue heartbeat instead of accepting Docker's initial "started" response. Before
an API swap, the operator script records whether the baseline worker was running.
Rollback to an absent/stopped baseline stops the candidate worker; it does not
start jobs on an older API-only release. Baselines without recorded metadata keep
the previous start-worker behavior. Invalid metadata fails explicitly. This is
single-worker startup readiness, not per-replica health or job-delivery proof;
install revised operator tooling only after its isolated recovery tests pass.

Run the manual **Isolated Rollback Rehearsal** workflow for `legacy` first.
It uses an empty GitHub-hosted Docker daemon, a disposable local Git remote and
synthetic database settings; it receives no production/staging secrets and does
not contact the VPS servers. It executes the real deployment harness and retains
its transcript even on failure. A pass proves only the harness scenarios, not
production data compatibility, first-worker recovery, or whole API/web rollback.
Keep those additional operational gates separate. Do not run the harness on a
developer daemon holding application images; it intentionally refuses that case.

The legacy `deploy/deploy-web.sh` and its `deploy-console.sh` alias now refuse
direct deployment before reading environment files, building or contacting a
server. Their former local rebuild and directory swap bypassed accepted-artifact
provenance and the release lock. Use Staging Release followed by Production
Release; there is no bypass flag. Older checkouts still contain the old script,
so operator access and concurrent writers must be audited before web migration.

`deploy/install-ci-production.sh` prepares the dedicated `mento-ci-production`
identity using a reviewed receiver and one `production-ci.pub` Ed25519 key. It
refuses an existing account or enabled server gate, restricts the key and SSH user
to the receiver, disables forwarding and keeps the key path root-owned. It does
not update the application, migrate web files
or enable promotion. A partial installation must be audited before retrying;
the script deliberately does not delete an existing identity to recover.

The reviewed `deploy.sh` is installed as root-owned
`/usr/local/lib/mento-release/operator-deploy.sh`. CI uses this stable copy for
both deployment and rollback, with `MENTO_CHECKOUT_ROOT=/opt/mento`; a checkout
reset cannot replace its functions with an older artifact's operator code.
Compose and helper paths still come from the selected application checkout.

Production deployment additionally requires the root-owned, non-symlink file
`/etc/mento-release/production-enabled`, not writable by group/others, containing
exactly `enabled` (surrounding whitespace is ignored). The installer leaves it
absent. Create it only after all operational gates below pass, alongside the
GitHub production environment switch. Artifact reception alone does not activate
an application. The production workflow uses the dedicated CI account; operator
SSH remains separate. A disposable Linux container rehearsal with real SSH proved
shell commands, TCP forwarding, arbitrary sudo and locked deployment are denied;
the key path is not writable and repeat installation refuses existing accounts.
Only systemd reload is stubbed in this container. Test CI repeats this check in
`receiver-isolation`, required by `test-gate`. Host-specific SSH configuration and
operator-script readiness still need verification before installation on A.

Master branch protection now requires `lint`, `test` and `test-gate` on an
up-to-date PR, enforces the rules for administrators, resolves review threads and
forbids force pushes/deletion. Native release evidence remains a separate
exact-commit release gate because native PR checks are path-filtered.

The receiver's production verification targets the current legacy container names:
API and worker must both run the accepted image identity, followed by a fresh
Procrastinate queue heartbeat within a bounded wait. Failure triggers runtime
rollback. This is a single-worker readiness signal, not task-delivery proof or
per-replica health; update the contract before moving to Balanced container names
or multiple workers. Test actual queued job completion independently.

For the legacy web-directory prerequisite, `deploy/web-release-layout.py` is an
operator preparation tool, not a CI deployment step. With promotion locked and all
web writers stopped, run it on Linux with `/opt/mento-console` as the explicit root.
It copies and hashes the static files, then atomically exchanges `current` with a
release symlink using `renameat2`; the untouched original is retained under the
printed `.legacy-current-*` name. Preserve that name. Immediate rollback uses the
same root plus `--rollback <retained-name>`. Do not use this bootstrap rollback
after subsequent releases without reviewing which version would be restored.
Local Linux tests prove file/inode preservation and refusal of unexpected symlink
assets; the tool has not been run on production. Unsupported filesystems fail
without replacing `current`. Review retained copies before any later cleanup.

Before scaling or changing pool settings, run the offline connection-budget check
with effective settings, including both API colors during rollout. For example:

```sh
python scripts/ci/database_budget.py --api-processes 2 --worker-processes 1 --pool-size 5 --max-overflow 5 --queue-pool 4 --migration-connections 1 --reserved 3 --headroom 5 --max-connections 50 --other-connections 0
```

This example budgets 43 connections including reserves; it is not installed tuning
or capacity evidence. The checker assumes the same SQLAlchemy pool settings for
each API/worker process; for heterogeneous pools use the largest values for a
conservative bound. Count all processes, including overlapping releases. Account
for additional database clients in headroom and verify actual PostgreSQL reserved
slots. Zero-size/unlimited pools are rejected. This is a manual preparation tool,
not yet an enforced deployment gate. Four worker queue connections are separate
from each worker's SQLAlchemy pool.

Run `deploy/production-preflight.sh` read-only on VPS A before planning promotion.
It reports prerequisites without printing secrets. A pass does not replace the
manual gates below. On 3 October, API readiness, rollback-tag presence and disk
headroom passed; safety-webhook freshness, running worker, web release symlink
and worker-aware installed deploy script failed. The deployed script at 92b8f57
parses its old functions before resetting the checkout, so merely deploying a
new commit will not add worker startup to that invocation. Install and review the
updated operator script before enabling the production receiver, then prove job
execution and rollback; do not accept an API-only success as a complete release.

- Complete the Expo PR chain (#11 → #12 → #13) with native evidence; do not merge
  red dependencies merely because the newest web/API jobs passed.
- Rehearse the complete Staging Release workflow on a green master SHA. A manual
  browser/fixture check is useful evidence but is not the complete workflow.
- Rehearse API/web failure rollback and migration compatibility. Restrict schema
  changes to expand/contract releases so older images can still serve.
- Provision and verify the restricted production receiver and immutable web
  layout, audit the legacy deploy script on A, and retain a tested rollback target.
- Confirm current backup restore, encrypted retention, monitoring alerts, worker
  operation, production crisis health and private secret handling. Backups created
  by the receiver are private files, but not yet encrypted or automatically pruned.
- Run erasure/reconnect/restart and scoped push acceptance plus capacity tests.
  Staging restore temporarily adds another bounded Postgres container; watch B's
  memory/disk and keep large builds on GitHub runners.
- Enable branch/environment protections when available. Only after the operational
  gates pass enable production promotion, release a small cohort and watch error,
  latency, queue and saturation metrics before wider rollout.

## Growth path

Measure concurrent connected users, message rate, API p95/p99, database pool wait,
worker queue age and memory before advertising a user limit. Keep web artifacts
separate from API/worker delivery; move assets to object storage/CDN, then move
Postgres and cache to independently backed-up managed services. Add stateless API
and worker replicas behind a load balancer with bounded aggregate database pools.
Keep monitoring and backup failure domains independent. Use measured saturation
and availability targets to trigger these moves. See
`ENTERPRISE_PLATFORM_PLAN_2026-10-02.md` for the broader product/iOS programme.

The database budget requires an explicit `--other-connections` allowance for
non-Mento clients sharing PostgreSQL (including GlitchTip web/background processes
when enabled). Zero in the example assumes none are running; it is not a valid
GlitchTip deployment allowance. Derive the aggregate ceiling from the effective
service/process/pool settings before rollout. The calculator does not discover
Compose services and is not capacity or load-test evidence.
