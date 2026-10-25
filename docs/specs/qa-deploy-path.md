# QA deploy path: one way to ship to QA

Status: recommendation, needs the founder's decision. Read from the repo on 2026-10-25; nothing here was run on the QA box.

## The two paths today

| | Actions receiver | `ops/qa-deploy-api.sh` |
|---|---|---|
| Trigger | `staging-release.yml` (`workflow_dispatch`) SSHes as `mento-ci-staging`, runs `receive`, `deploy`, `accept`, `fixture`, `cleanup`, `verify` through `deploy/ci-receiver.py` | Root runs it by hand with an image tag |
| Gates | Exact-SHA master check, signed image labels, fixture-driven browser acceptance, `alembic check`, safety script, restore drill | Image exists, readiness URL returns 200 within 60 s |
| DB safety | `pg_dump` into `predeploy-backups/` before every migration | Records Alembic revision before and after; no DB dump |
| Failure | Restores the previous `ci.override.yml` and web symlink, recreates `api` and `worker` | Restores the previous override and recreates `api` and `worker` |
| Standalone rollback | None (only on a failed deploy) | `--rollback` swaps back to `previous-api-tag` |
| Web | Unpacks the candidate's web archive and flips the symlink | Not covered (`qa-install-web` does it) |

## Finding: the Actions path cannot run

`master` was renamed to `main`, and `git ls-remote` shows no `master` on the remote. But:

- `staging-release.yml` and `production-release.yml` gate on `github.ref == 'refs/heads/master'`, check out `master` and compare against `origin/master`.
- `test-ci.yml` triggers `push` only on `master`, so it no longer runs on pushes to `main`.

Until those are changed, nothing deploys through Actions. (This also means the release workflows have not been triggered, and must not be, without the founder's say-so.)

## Options

1. **Revive Actions.** Change `master` to `main` in the three workflows, keep the receiver. Keeps fixture acceptance and the pre-migration dump. Needs Actions billing/minutes working (PR #22 mentions a billing blocker), and the Maestro workflow is off.
2. **`ops/` only.** Make `qa-deploy-api` the QA path, add the missing pieces from the receiver (pre-migration `pg_dump`, acceptance script), and retire the receiver for QA. No dependency on GitHub-hosted runners. Production would still need its own decision.
3. **Both, with a split.** `ops/` for day-to-day QA deploys of `dev`, Actions only for the production-bound release run. Cheapest to start, but two paths remain.

## Recommendation

Option 2 for QA. The receiver's useful parts are small and portable:

- Add a pre-migration `pg_dump` to `qa-deploy-api.sh` (same command the receiver runs: `pg_dump -U mento_staging -d mento_staging` through the `postgres` service into `predeploy-backups/`).
- Keep `ops/ci.sh` as the gate and have the deploy refuse a SHA with no successful `ops/ci` status.
- Leave the receiver and workflows in place, untouched, until production is decided. Fix the `master` references only when the founder picks option 1 or 3.

## What this does not decide

Production release, which needs its own audit and is off limits to agents.
