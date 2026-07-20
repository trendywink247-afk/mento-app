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

## Known gap: Sentry (TODO)

Error/crash reporting is **not wired** (out of scope for this lane). The >99.5%
crash-free target in PRELAUNCH_CHECKLIST §2E is unmeasured until `sentry-sdk`
is added to the API (and the mobile app). Tracked as an open launch-checklist item.
