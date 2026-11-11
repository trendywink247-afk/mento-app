# Operations: build, test, release, rollback

Everything below is a script or workflow in the repo. Nothing depends on anyone remembering the steps. Steps a human must do are marked **ROOT** or **FOUNDER**.

## Pipeline at a glance

| Stage | What runs | Trigger | Human step |
|---|---|---|---|
| Checks on a push/PR | `api-ci.yml` (ruff, black, alembic, pytest), `test-ci.yml` (typecheck, node tests, web export, release tooling drills), `security.yml` once merged | Automatic | None |
| QA gate on this box | `ops/ci.sh <sha>` posts `ops/ci`; log in `/srv/mento/logs/ci/<sha>.log` | `ops/ci-poll.sh` timer for `dev`, `main`, `feat/*` | None |
| QA API deploy | `ops/build-api.sh <sha>` then `qa-deploy-api <tag>` (needs a passing ci log; dumps DB; auto-rollback if `/health/ready` fails) | By hand | **ROOT**: `sudo qa-release <sha>` |
| QA web + admin | `ops/qa-apk.sh` stages a tarball; `qa-install-web` verifies and swaps the symlink | APK poller or by hand | **ROOT**: `sudo qa-install-web <tarball>` (APK poller uses a root helper, no prompt) |
| QA JS update to phones | `ops/ota-publish.sh qa` (signed, self-hosted; refuses if the native layer changed) | By hand | None |
| QA APK | `ops/qa-apk-poll.sh` every 15 min: rebuilds only when the native fingerprint of `origin/dev` changed; publishes to `/downloads/` | systemd timer | **ROOT** one-time install |
| Staging / Production release | `staging-release.yml`, `production-release.yml` | Manual (Actions) only | **FOUNDER** starts it |
| Play upload | `docs/PLAY_RELEASE.md` | Manual | **FOUNDER** |

## Rules for an agent

- Never start the staging or production release workflows unless asked for that specific run.
- Run `ops/ci.sh <sha>` on the exact commit before asking root to deploy it.
- Never push to `main`/`master`; branch `feat/<topic>` from `dev`; ask before opening a PR.
- `gh pr merge` is the founder's.

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

- Production Release and the Rollback Rehearsal workflows have never been run.
- `native-gate` is a required check on `main` that nothing produces; the founder must remove it.
- Two QA steps still need a root keystroke (`qa-release`, `qa-install-web`); that is deliberate.

More detail: [environments.md](environments.md), [DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md), [ANDROID_BUILD.md](ANDROID_BUILD.md), [specs/qa-deploy-path.md](specs/qa-deploy-path.md).
