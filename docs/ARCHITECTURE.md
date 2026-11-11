# Architecture

One page. Product rules are in [DECISIONS.md](DECISIONS.md); hosts and users are in [environments.md](environments.md); pipelines are in [OPERATIONS.md](OPERATIONS.md).

## Shape

```text
Android app / web (Expo, expo-router)        Admin console (web, same codebase)
        |  HTTPS                                      |
        v                                             v
     Caddy (TLS, headers, allowlist) ---------> static web release  (/opt/mento-staging/web)
        |
        v
   FastAPI  (services/api)  <---- Postgres 16 (messages encrypted AES-256-GCM, MESSAGE_KEY)
        |  \                      Valkey (rate limits, chat pub/sub, presence; cache only)
        |   \--> worker (Procrastinate jobs, same image, queue lives in Postgres)
        |
        +--> Stream Chat (legacy chat; signed hooks enforce the crisis scan)
        +--> FCM push, Sentry/GlitchTip (errors only, scrubbed)
```

## Parts

| Part | Where | Notes |
|---|---|---|
| Mobile + web client | `apps/mobile` | Expo SDK 55, RN 0.83, TypeScript. Typed API clients in `lib/*Api.ts`. Theme tokens in `theme/`. |
| API | `services/api` | FastAPI, SQLAlchemy 2, Alembic, pydantic. Routers in `app/routers`, logic in `app/services`. Additive-only contract. |
| Own chat | `app/chat_hub.py`, `routers/chat.py` | WebSocket hub, Valkey pub/sub fan-out, local fan-out when Valkey is down. Stream Chat is still wired for builds that use it; check `lib/` before assuming which chat a screen uses. |
| Safety | `app/services` (crisis scan), `routers/safety.py` | Server-side scan on every message; 18+ gate server-side; anonymity both sides; real deletion (Clean Wipe). |
| Recovery receiver | `services/recovery_receiver` | Isolated encrypted-recovery service. |
| Deploy tooling | `deploy/`, `ops/`, `infra/` | Compose stacks, blue/green, QA scripts, Caddy, systemd timers. |

## Key decisions (the ones that bite)

- **No login, no name.** Identity is an install id plus a token; email is optional recovery.
- **Valkey is a cache, not a store.** Everything in it must expire. Rate limiting fails open (logged) when it is down.
- **API is additive only.** Shipped app builds keep calling old shapes. Migrations are expand/contract and forward-only.
- **Errors only to Sentry.** Allowlist scrubbing on both sides; no message text, IPs or device names leave.
- **Two ways to update a phone.** JS-only changes go over the air from our own signed update server (`services/ota`, [OTA.md](OTA.md)); native changes need a new APK. `runtimeVersion` follows `appVersion`, so OTA reaches every APK of that version.

## Environments

| Env | Host | Status |
|---|---|---|
| Local | dev box | Throwaway Postgres/Redis on 127.0.0.1 |
| QA | `129.121.171.140`, Caddy, compose project `mento-staging` | Live |
| Production | to be set up on the same box until launch, separate instance after | Not live; see [PRODUCTION_AND_PLAY_STEPS.md](PRODUCTION_AND_PLAY_STEPS.md) |

Diagrams: [diagrams/](diagrams/). Original design: [specs/2026-09-20-mento-balanced-architecture-design.md](specs/2026-09-20-mento-balanced-architecture-design.md).
