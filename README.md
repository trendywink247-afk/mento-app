# Mento

**An anonymous, low-friction emotional-support app.** Open it in a hard moment and you're talking to a real human in under 30 seconds — no login, no name, no judgment. UPSC aspirants are our first community; the product is the conversation.

> First-time here? The durable project brain is **`CLAUDE.md`**. The "what do we build and why" decisions live in **`docs/DECISIONS.md`** (it wins over the PRD and mockups on any conflict). The restart-from-anywhere log is **`PROGRESS.md`**.

---

## Status

**v1 (Module A) is built and running locally.** The full anonymous-support loop works end-to-end and is verified continuously on Expo web (Playwright) + pytest:

- Cinematic onboarding (single-route journey over an ambient shader sky, living mascot, haptics) → anonymous persona → **live 1:1 Stream chat** in ~5s.
- **Server-side crisis enforcement** on the message path (Stream webhooks — un-bypassable from the client), verified India helplines.
- Conversation controls (PIN lock, Panda Mask, Panda Pause, honest End/Wipe with real server-side deletion, Report/Block → moderation queue).
- End-of-conversation reflection (private, no points), save-to-Mentor-Notes, Journals hub (Mood/Finance/Gratitude/Mentor Notes), My Chats, Mentor discovery + Personal requests, Profile with live theme switching + Start fresh.

Not yet: Razorpay wiring (creds), AI Journal Assistant (LLM decision), native device verification (Maestro), Module B mentor portal. Exact current state: `PROGRESS.md`.

## Project layout

```
mento/
  apps/mobile/          Expo SDK 52 React Native app (iOS/Android primary, web = dev/test surface)
    app/                expo-router routes (onboarding journey, chat, (tabs): chats/journals/mentors/profile)
    components/         UI + art/ (SVG mascot & scenes) + motion/ (ambient sky, primitives) + chat/ + onboarding/
    theme/              tokens.ts (colour/type/space) · motion.ts (durations/easings) · companion accent system
    lib/                typed API client, session store, haptics, reduced-motion
  services/api/         FastAPI backend (Python 3.12, SQLAlchemy 2 + Alembic, Postgres + Redis via docker compose)
    app/routers/        onboarding · match · conversation · stream_hooks (crisis) · moderation · journals · listeners
    scripts/            seed_listeners · configure_stream (webhooks)
    tests/              pytest (incl. matcher-concurrency + crisis-webhook proofs)
  docs/
    PRD.md              Product requirements (v2.0)
    DECISIONS.md        Authoritative reconciliation + founder rulings (source of truth)
    ALIGNMENT.md        PRD × mockups × build-now table
    MOCKUP_INVENTORY.md Pixel-verified catalog of all 64 UI screens
    Mockups/            64 source screens
  .github/workflows/    api-ci.yml — compose up → alembic upgrade + check → pytest on every services/api push
  CLAUDE.md  AGENTS.md  PROGRESS.md
```

## Stack

| Layer | Choice |
|---|---|
| Mobile | Expo SDK 52 (React Native, TypeScript strict) + expo-router 4 |
| Motion | react-native-reanimated 3.16 + **@shopify/react-native-skia 1.5** (ambient SkSL shader; lazy CanvasKit on web) + expo-haptics, all driven by `theme/motion.ts` tokens |
| Backend | FastAPI (Python 3.12), Pydantic v2, SQLAlchemy 2.0 + Alembic |
| Data | Postgres 16 + Redis 7 (docker compose locally; DigitalOcean managed in staging/prod) |
| Messaging | Stream Chat (presence/typing/read-state; crisis scan enforced via its webhooks) |
| Payments | Razorpay — contributions only, transparently disabled until creds land |
| Analytics | PostHog (never message content / PII; crisis sessions excluded from retention) |

MSG91 is reserved for mentor verification in the deferred Module B — **not** in the v1 user path. Full rationale in `CLAUDE.md`.

---

## Running locally

### Prerequisites
- Node 20+ and npm · Python 3.12+ · Docker Desktop
- A browser (web is the dev/test surface) — or Expo Go / a simulator for native

### 1. Backend — `services/api`
```powershell
cd services/api
# .env: copy .env.example, fill in at least JWT_SECRET; STREAM_* enables real chat (stub mode without)
docker compose up -d --wait                    # Postgres 16 + Redis 7
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.seed_listeners   # 3 approved listeners (+ Stream upsert)
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000   # docs at /docs
```
(First time: `python -m venv .venv` + `pip install -r requirements-dev.txt`.)

⚠️ Running `pytest` truncates the dev DB's listeners (test fixtures) — re-run `scripts.seed_listeners` afterwards or matching returns 503.

### 2. Mobile — `apps/mobile`
```powershell
cd apps/mobile
# .env: EXPO_PUBLIC_API_URL=http://localhost:8000  (+ EXPO_PUBLIC_STREAM_API_KEY for real chat)
npm install
npx expo start --web --port 8081    # add -c after dependency changes
```
Open http://localhost:8081. Returning sessions land on My Chats — use Profile → **Start fresh** (or incognito) to replay onboarding.

### 3. Crisis-webhook enforcement (live-testing only)
The crisis scan is enforced by Stream calling our API server-to-server, so live Stream needs a public URL:
```powershell
cloudflared tunnel --url http://localhost:8000          # copy the trycloudflare URL
.\.venv\Scripts\python.exe -m scripts.configure_stream https://<tunnel-url>
```
Per-session quick tunnels are a dev convenience; staging needs a stable URL (tracked in `PROGRESS.md`).

### Verification conventions
- Backend: `pytest` (hermetic Stream stubs; Postgres required — concurrency tests use row locks).
- Mobile: `npx tsc --noEmit` + Playwright walkthroughs on Expo web at 390×844, asserting **0 console errors** (see PROGRESS for the established flows).
- CI: `.github/workflows/api-ci.yml` runs compose → `alembic upgrade head` → `alembic check` → pytest on every `services/api` push.

---

## Env vars

Never commit real secrets. `.env` files are gitignored; each package ships an `.env.example`.

### Backend (`services/api/.env`)
| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres (defaults to the compose instance `postgresql+psycopg://mento:mento@localhost:5432/mento`) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` / `DB_POOL_TIMEOUT` / `DB_POOL_RECYCLE` | Connection pool tuning (defaults 20/20/5s/1800s; per-process — keep workers × (size+overflow) under Postgres `max_connections`) |
| `REDIS_URL` | Redis — backs the rate limiter (`app/ratelimit.py`); defaults to compose |
| `RATE_LIMIT_ENABLED` | Default `true`; limiter fails open (with a warning) if Redis is down |
| `JWT_SECRET` | Anonymous session + listener tokens (HS256). **Outside dev the API refuses to boot with the default value.** |
| `STREAM_API_KEY` / `STREAM_API_SECRET` | Stream Chat server credentials — absent = dev stub mode. **Outside dev the API refuses to boot without them** (the crisis scan would be silently off). |
| `STREAM_TIMEOUT_SECONDS` | Outbound Stream API budget (default 3s) |
| `ADMIN_TOKEN` | Guards the moderation queue + the Personal-request accept/decline stand-in; empty = disabled |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Payments (contributions) — not yet wired |
| `POSTHOG_API_KEY` / `POSTHOG_HOST` | Analytics (no message content / PII) |

### Mobile (`apps/mobile/.env`)
| Var | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Backend base URL |
| `EXPO_PUBLIC_STREAM_API_KEY` | Stream Chat client key (publishable) |
| `EXPO_PUBLIC_POSTHOG_KEY` / `EXPO_PUBLIC_POSTHOG_HOST` | Analytics |

---

## Trust & Safety

This is a mental-health-adjacent product. Crisis handling (server-side, fail-open-but-never-silent), honest payments, anonymity on **both** sides of the chat, age-gating, and "privacy policy matches reality" are **non-negotiable** and specified in `CLAUDE.md` → *Trust & Safety*. Read that before touching chat, payments, or onboarding.

## Contributing / working rhythm

Conventional commits; each unit proven (tests/Playwright) before the next. At the end of every meaningful unit: update `PROGRESS.md`, commit with a clear message, and note the exact resume command. `PROGRESS.md` is designed so anyone (including a fresh AI session) can pick up cold.
