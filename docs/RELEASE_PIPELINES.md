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
