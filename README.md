# Mento

**An anonymous, low-friction emotional-support app.** Open it in a hard moment and you're talking to a real human in under 30 seconds — no login, no name, no judgment. UPSC aspirants are our first community; the product is the conversation.

> First-time here? The durable project brain is **`CLAUDE.md`**. The "what do we build and why" decisions live in **`docs/DECISIONS.md`** (it wins over the PRD and mockups on any conflict). The restart-from-anywhere log is **`PROGRESS.md`**.

---

## Status

Pre-build. Docs + alignment complete; app/backend not yet scaffolded. See `PROGRESS.md`.

## Project layout

```
mento/
  apps/mobile/        Expo SDK 52 React Native app (iOS/Android/web)   ← not yet created
  services/api/       FastAPI backend                                  ← not yet created
  docs/
    PRD.md            Product requirements (v2.0)
    DECISIONS.md      Authoritative reconciliation (source of truth)
    ALIGNMENT.md      PRD × mockups × build-now table
    MOCKUP_INVENTORY.md   Catalog of all 64 UI screens
    Mockups/          64 source screens
  CLAUDE.md  AGENTS.md  PROGRESS.md
```

## Stack

Expo SDK 52 (RN, TS) · FastAPI (Python 3.12) · DigitalOcean Managed Postgres · Redis · Stream Chat · Razorpay · PostHog. (MSG91 reserved for mentor verification, a later module — **not** the v1 user path.) Full rationale and open questions in `CLAUDE.md`.

---

## Running locally

> The app and backend aren't scaffolded yet. These are the intended commands; this section gets filled in as `apps/mobile` and `services/api` land (tracked in `PROGRESS.md`).

### Prerequisites
- Node 20+ and `npm` (or `pnpm`)
- Python 3.12+ and `uv` (or `venv` + `pip`)
- Docker (for local Postgres + Redis), or managed instances
- Expo Go on your phone, or an iOS/Android simulator

### Backend — `services/api`
```bash
cd services/api
cp .env.example .env          # fill in secrets (see Env vars)
uv sync                       # or: python -m venv .venv && pip install -r requirements.txt
alembic upgrade head          # run migrations
uvicorn app.main:app --reload # http://localhost:8000  (docs at /docs)
```

### Mobile — `apps/mobile`
```bash
cd apps/mobile
cp .env.example .env          # point EXPO_PUBLIC_API_URL at your backend
npm install
npx expo start                # press i / a for simulator, or scan QR in Expo Go
```

### Local infra (optional)
```bash
docker compose up -d          # postgres + redis  (compose file added with the backend)
```

---

## Env vars

Never commit real secrets. Each package ships an `.env.example`; copy to `.env` and fill in.

### Backend (`services/api/.env`)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | DigitalOcean Managed Postgres connection string |
| `REDIS_URL` | Redis (presence, matching queue, rate limits) |
| `STREAM_API_KEY` / `STREAM_API_SECRET` | Stream Chat server credentials |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payments (contributions; later session fees) |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | Analytics (no message content / PII) |
| `JWT_SECRET` | Anonymous session tokens |
| `MIN_AGE` | Age-gate threshold (see Trust & Safety) |
| `CRISIS_HELPLINES_JSON` | Verified India helpline list (Tele-MANAS / KIRAN) |

### Mobile (`apps/mobile/.env`)
| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL |
| `EXPO_PUBLIC_STREAM_API_KEY` | Stream Chat client key |
| `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` | Analytics |

---

## Trust & Safety

This is a mental-health-adjacent product. Crisis handling, honest payments, anonymity, age-gating, and "privacy policy matches reality" are **non-negotiable** and specified in `CLAUDE.md` → *Trust & Safety*. Read that before touching chat, payments, or onboarding.

## Contributing / working rhythm

At the end of every meaningful unit of work: update `PROGRESS.md`, commit with a clear message, and note the exact resume command. `PROGRESS.md` is designed so anyone (including a fresh AI session) can pick up cold.
