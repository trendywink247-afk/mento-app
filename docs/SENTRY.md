# Sentry: four projects, four keys

Errors only, scrubbed (no message text, bodies, headers, user or IP; see `docs/environments.md`).
Each environment has its own Sentry project for the API and for the app, so there are four DSNs.
A DSN is a variable you fill in. Nothing in the repo holds one.

## The four keys

| # | Key (variable) | Project | Goes where |
|---|---|---|---|
| 1 | `SENTRY_DSN` | API, QA | QA host: `/opt/mento-staging/secrets/api.env` (root edits). Also `ENV=qa` |
| 2 | `SENTRY_DSN` | API, Prod | Prod SOPS env `deploy/secrets/prod.env.sops.yaml`. Also `ENV=prod` |
| 3 | `EXPO_PUBLIC_SENTRY_DSN` | App, QA | `.secrets/qa.env` (read by `ops/lib/build-env.sh`: QA APK, QA web, QA OTA) |
| 4 | `EXPO_PUBLIC_SENTRY_DSN` | App, Prod | `.secrets/prod.env` (read by `ops/lib/build-env.sh` for prod builds and prod OTA) |

An app DSN ships inside the app, so it is not a secret, but keep it out of git anyway.
The API DSN is not public: treat it like a secret.

Send me the values by name only. I put them in `.secrets/<env>.env` (not in the repo, mode 600) and never print them.
Example `.secrets/qa.env` (names only here):

```
SENTRY_DSN=...                 # API QA
EXPO_PUBLIC_SENTRY_DSN=...     # app QA
SENTRY_AUTH_TOKEN=...          # optional: sourcemap upload
SENTRY_ORG=...                 # optional
SENTRY_PROJECT=...             # optional: the app QA project
```

## How the environment is chosen

| Where | Variable | Value |
|---|---|---|
| API | `ENV` | `qa` or `prod`. Anything else, or no DSN, = off. Never defaults to production |
| App | `EXPO_PUBLIC_APP_ENV` | Set by `ops/lib/build-env.sh`: `qa` builds = `qa`, `prod` builds = `production`. A dev build has none, so Sentry is off |

## Release and dist

- API `release` = `GIT_SHA`. The image bakes it in: `services/api/Dockerfile` has `ARG GIT_SHA`; `ops/build-api.sh` passes the commit. An `env_file` value still wins.
  The `deploy/deploy.sh` compose build path does not pass it yet, so an image built there has no release tag.
- App `release` = `EXPO_PUBLIC_GIT_SHA` (set by `ops/lib/build-env.sh`).
- App `dist` = the Android `versionCode`, read at runtime from the build's own config. Release plus dist selects one sourcemap.

## Sourcemap and symbol upload

Off unless `.secrets/<env>.env` has `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`. The Gradle/Xcode hooks never upload on their own (`SENTRY_DISABLE_AUTO_UPLOAD=true`); `ops/build-android.sh` and `ops/build-ios.sh` upload afterwards with `sentry-cli` (release = sha, dist = build number). A failed upload is a warning; the build is kept. Mobile reports JS errors only (`enableNative: false`).

## Verify

```
ops/sentry-smoke.sh qa --dry-run          # shows host + project id per target, sends nothing
ops/sentry-smoke.sh qa                    # one labelled test event each for API and app, QA
ops/sentry-smoke.sh prod --yes-prod api   # production needs the flag
```

The event reads "mento sentry smoke test ... safe to ignore" and carries the tag `smoke_test=true`. A missing file or key is skipped, not an error.
Then confirm in Sentry: the event lands in the right project with environment `qa` or `production`.
A real app error check: on a QA build with a DSN, trigger a handled test error and see it appear scrubbed.

## Tests

`apps/mobile/e2e/sentry-config.test.cjs` (options, scrubber, profile to environment mapping, no DSN in `ops/lib/build-env.sh`) and `services/api/tests/test_observability.py` (environment mapping, off without DSN, release, image build arg).

## Still open

- Remove the self-hosted GlitchTip from `deploy/compose.prod.yml` if Sentry replaces it (your call).
- Nothing reports until the four DSNs are set.
