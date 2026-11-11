# Operations: build, test, release, rollback

Everything below is a script in the repo, run on our own machines; there is no GitHub automation. Nothing depends on anyone remembering the steps. Steps a human must do are marked **ROOT** or **FOUNDER**.

## Pipeline at a glance

| Stage | What runs | Trigger | Human step |
|---|---|---|---|
| Checks | `ops/ci.sh <sha>` (API, mobile, receiver, shell lint, drills; `--quick` for lint+unit), `ops/security-scan.sh` weekly, `ops/deps-check.sh` weekly, `ops/sonar-scan.sh` ([CI.md](CI.md)) | Local, timers | None |
| QA gate on this box | `ops/ci.sh <sha>` posts `ops/ci`; log in `/srv/mento/logs/ci/<sha>.log` | `ops/ci-poll.sh` timer for `dev`, `main`, `feat/*` | None |
| QA API deploy | `ops/build-api.sh <sha>` then `qa-deploy-api <tag>` (needs a passing ci log; dumps DB; auto-rollback if `/health/ready` fails) | By hand | **ROOT**: `sudo qa-release <sha>` |
| QA web + admin | `ops/qa-apk.sh` stages a tarball; `qa-install-web` verifies and swaps the symlink | APK poller or by hand | **ROOT**: `sudo qa-install-web <tarball>` (APK poller uses a root helper, no prompt) |
| QA JS update to phones | `ops/ota-publish.sh qa` (signed, self-hosted; refuses if the native layer changed) | By hand | None |
| QA APK | `ops/qa-apk-poll.sh` every 15 min: rebuilds only when the native fingerprint of `origin/dev` changed; publishes to `/downloads/` | systemd timer | **ROOT** one-time install |
| Production release | `sudo ops/prod-release.sh <main sha> --yes-production` (refuses non-main commits and commits without a CI pass; `--dry-run`, `--status`, `--rollback`). Prod OTA: `ops/ota-publish.sh prod` then `sudo ops/ota-publish.sh --install-prod <tarball> --yes-production` ([PRODUCTION.md](PRODUCTION.md)) | By hand | **FOUNDER** approves the `dev` -> `main` merge and each deploy |
| Play upload | `docs/PLAY_RELEASE.md` | Manual | **FOUNDER** |

## Rules for an agent

- Commit to `dev`. QA may be deployed from `dev` or from uncommitted work; commit after QA passes.
- `dev` -> `main` only with the founder's explicit approval. Production deploys only from `main`, on request.
- Run `ops/ci.sh <sha>` on the exact commit before asking root to deploy it.
- No GitHub Actions or Dependabot: everything runs from `ops/`.

## Common tasks

| I want to | Do |
|---|---|
| Test an API change on QA | PR merged to `dev` -> `ops/ci.sh <sha>` -> founder runs `sudo qa-release <sha>` |
| Ship a JS-only app fix to QA phones | `ops/ota-publish.sh qa -m "what changed"`; relaunch the app twice. Roll back: `ops/ota-publish.sh --rollback preview <runtime>` |
| Ship a native change | Merge to `dev`; the APK poller builds it (or `ops/qa-apk-poll.sh --force`); check `--status` |
| Roll back web | `sudo qa-install-web --rollback` |
| Roll back API | `sudo qa-deploy-api --rollback` (image only; migrations stay, so they must be expand-only) |
| See what is live | `ops/qa-apk-poll.sh --status`, `/opt/mento-staging/deploy-history.log` |

## Backups

Nightly encrypted dump, off-box copy when `QA_BACKUP_REMOTE` is set, weekly restore drill into a throwaway container (`ops/qa-backup.sh`, `ops/qa-restore-drill.sh`, units in `infra/systemd/`). Policy: [BACKUP_CONTENT_POLICY.md](BACKUP_CONTENT_POLICY.md).

## One-time root installs

`infra/qa-root-setup.sh` (deploy, backup, drill, CI poller), `infra/qa-agent/README.md` (APK publisher and timer), `infra/caddy/RUNBOOK.md` (edge). Each is idempotent and has `--dry-run` or a printed plan.

## Known gaps

- The production release path has never been run; rollback drills: `ops/release-drills.sh`.
- `native-gate` is a required check on `main` that nothing produces; the founder must remove it.
- Two QA steps still need a root keystroke (`qa-release`, `qa-install-web`); that is deliberate.

More detail: [environments.md](environments.md), [DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md), [ANDROID_BUILD.md](ANDROID_BUILD.md), [specs/qa-deploy-path.md](specs/qa-deploy-path.md).
