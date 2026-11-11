# Secrets

Where keys live, who may read them, and how an agent handles one the founder shares. Values never appear in this repo, in a commit, a PR, a log or a chat reply: refer to a secret by its name only.

## The local folder

`/srv/mento/mento-app/.secrets/` on the dev box.

- Git-ignored (`.secrets/` is the first rule in the root `.gitignore`). Check with `git check-ignore -v .secrets/x`.
- Directory mode `700`, files mode `600`, owner `agent`.
- It exists only on this box. Keep the originals in the team password manager; this folder is a working copy.

| File (suggested name) | Holds | Used by |
|---|---|---|
| `qa.env` | `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_DSN` for QA, `APP_ENV=qa` | `ops/qa-apk.sh`, QA web export, QA API deploy |
| `prod.public.env` | Prod app/API Sentry DSNs (low sensitivity; they ship inside the client) | EAS production profile, prod release |
| `sentry.env` | `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | Sourcemap/release upload |
| `fcm-service-account.json` | Firebase service account for push | Mounted on the server, never committed |
| `play-upload.jks` + `play-upload.env` | Google Play upload key and its passwords | `docs/PLAY_RELEASE.md` |

Scripts that read it must tolerate a missing file (feature off, no crash) and must never print the values.

## What does NOT go in this folder

This box is agent-accessible and production is off limits to agents (CLAUDE.md). So these stay out:

- `MESSAGE_KEY`, production database and Redis passwords, the production age private key, the QA server age key (`/etc/mento/age/qa.key`).
- Anything that would let an agent read production data.

Those live in SOPS (`deploy/secrets/`, `deploy/staging/secrets/`) or on the host, with the keys in the password manager.

## When the founder shares a secret

1. Write it straight to the right file under `.secrets/` (Write tool or `umask 077`), without echoing it back.
2. `chmod 600` it, confirm with `git status` that nothing new is tracked.
3. Reply with the file name and variable name only, never the value.
4. If it must reach a server, say which root step installs it (an agent cannot).

## Repo-tracked secrets (encrypted)

| Path | Encrypted with | Edit with |
|---|---|---|
| `deploy/secrets/prod.env.sops.yaml` | SOPS + age (prod recipients) | `sops deploy/secrets/prod.env.sops.yaml` on a machine with the key |
| `deploy/staging/secrets/*.enc.env` | SOPS + age (QA server key + recovery key) | `SOPS_AGE_KEY_FILE=/etc/mento/age/qa.key sops <file>` on the QA box as root |

Details of the QA flow: [environments.md](environments.md).

## Client-side values

`EXPO_PUBLIC_*` ships inside the app, so it can never be a secret. A Sentry DSN is fine there; an auth token is not.
