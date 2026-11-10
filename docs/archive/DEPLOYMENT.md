# Mento API — Deployment

> Ops readiness for `services/api` (FastAPI, Python 3.12, Alembic, Postgres 16, Redis).
> Container ships migrations-on-deploy: the entrypoint runs `alembic upgrade head`
> before starting uvicorn, and refuses to serve if migrations fail.

## Build & run

```bash
# From repo root
docker build -t mento-api services/api

# Run (env from a filled-in copy of services/api/.env.example)
docker run --env-file services/api/.env -p 8000:8000 mento-api
```

The image runs as a non-root user, defaults to 2 uvicorn workers
(`UVICORN_WORKERS`), and has a Docker `HEALTHCHECK` on `GET /api/v1/health`.

## Required env vars

See `services/api/.env.example` for the full annotated list. Non-negotiable in prod:

- `ENV=prod`
- `JWT_SECRET` — the API refuses to boot on the default outside dev.
- `ADMIN_JWT_SECRET` — must be set and differ from `JWT_SECRET`.
- `CORS_ORIGINS` — explicit console origins.
- `DATABASE_URL` — DO Managed Postgres (with `+psycopg`).
- `REDIS_URL`
- `STREAM_API_KEY` / `STREAM_API_SECRET`
- `TRUSTED_PROXY_HOPS=1` behind a single load balancer.

## DB connection budget

`UVICORN_WORKERS x (DB_POOL_SIZE + DB_MAX_OVERFLOW) x container_count` must stay
under Postgres `max_connections`. DO Managed Postgres (smallest tier) allows ~97;
budget ~90 after reserved slots. Container defaults: `2 x (5 + 5) = 20` per
container, so up to ~4 containers fit comfortably. Raise deliberately, not by default.

## Launch gate: crisis-pipeline uptime monitor

`GET /api/v1/health/crisis` is an ACTIVE alerting hook (PRELAUNCH_CHECKLIST §2E).
It returns **503** when Stream is configured but no webhook has arrived in 30
minutes, or Redis is down — meaning the crisis scan is silently dead. **An
external uptime monitor (e.g. UptimeRobot/Better Stack) pointed at this endpoint,
with paging, is a launch gate.** The plain `GET /api/v1/health` is liveness only.

## Backups

Use DO Managed Postgres built-ins: enable **daily backups** and rely on
**point-in-time recovery (PITR)** for the retention window. No app-level backup
job is needed. Verify the daily-backup switch is ON before launch.

## Sentry (wired 2026-07-30, env-gated)

Both sides init only when their DSN is set — empty DSN = fully off:

- **API**: `SENTRY_DSN`. Errors only (`traces_sample_rate=0`), `send_default_pii=False`,
  and a `before_send` hook strips request bodies — message content never reaches
  Sentry (T&S #10).
- **Mobile**: `EXPO_PUBLIC_SENTRY_DSN` (init in `components/AppProviders*`).
  **JS-error capture only for now** — native crash symbolication and source-map
  upload are release-build (EAS) work, still open. In Expo Go the SDK degrades to
  JS-only by itself.

## DigitalOcean App Platform runbook (`deploy/do-app.yaml`)

1. **Provision**: DO Managed **Postgres 16** and **Redis**; note both connection
   strings (keep the `+psycopg` driver prefix on `DATABASE_URL`).
2. **Create the app**: `doctl apps create --spec deploy/do-app.yaml` (fill the
   `github:` block first). Set every `type: SECRET` env in the DO console —
   distinct `JWT_SECRET` / `ADMIN_JWT_SECRET`, Stream creds, explicit
   `CORS_ORIGINS` + `CONSOLE_BASE_URL`. The spec sets `TRUSTED_PROXY_HOPS=1`.
3. **First deploy**: the `migrate` PRE_DEPLOY job runs `alembic upgrade head`
   (the serving entrypoint re-runs it idempotently). If the app refuses to boot,
   read the log — the startup invariants name exactly which env is unsafe.
4. **Point Stream at the public URL**: run `python -m scripts.configure_stream`
   with the deployed base URL, then prove the crisis scan live per the
   **mento-crisis-webhook** skill (a message sent straight through the Stream API
   must still flag + augment).
5. **Verify post-deploy**: `GET /api/v1/health` ok → seed/approve a listener and
   drive one real match → send a crisis-phrase message and confirm the flag →
   wire the uptime monitor at `/api/v1/health/crisis` (launch gate, above).
6. **Rotation note**: rotating the Stream secret invalidates webhook signatures —
   re-run `scripts.configure_stream` after any rotation.
