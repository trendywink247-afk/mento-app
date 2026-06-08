# Mento API (services/api)

FastAPI backend for the v1 slice: anonymous onboarding + age-gate → matching → Stream Chat, with the crisis-scan wired in from day one.

## Run locally
```bash
cd services/api
cp .env.example .env            # fill in (Stream/Razorpay optional in dev)
python -m venv .venv && . .venv/Scripts/activate   # Windows; or .venv/bin/activate
pip install -r requirements.txt
python -m scripts.seed_listeners   # creates approved/online listeners for matching
uvicorn app.main:app --reload      # http://localhost:8000  (Swagger at /docs)
```
In dev with `ENV=dev`, tables can be auto-created from the models and Stream calls degrade to safe stubs (no Stream creds needed to exercise onboarding/match).

## Database (Postgres + Alembic)
The real stack is Postgres (+ Redis). Bring it up and migrate:
```bash
cd services/api
docker compose up -d                 # Postgres on :5432 (mento/mento/mento), Redis on :6379
python -m alembic upgrade head       # apply migrations (schema lives in migrations/)
python -m scripts.seed_listeners
```
The DB URL comes from `DATABASE_URL` (default `postgresql+psycopg://mento:mento@localhost:5432/mento`); Alembic reads the same setting via `migrations/env.py`. To add a migration after a model change: `python -m alembic revision --autogenerate -m "..."` then review + `upgrade head`. `python -m alembic check` confirms the schema matches the models (used in review).

## Tests
```bash
pip install -r requirements-dev.txt
python -m alembic upgrade head        # tests run against the migrated schema
python -m pytest
```
`tests/test_matching_concurrency.py` proves General matching never double-assigns a listener under concurrency — it depends on `SELECT ... FOR UPDATE SKIP LOCKED` and so **requires Postgres** (auto-skips on SQLite, where row-locking is a no-op).

## Endpoints (v1)
| Method | Path | Purpose |
|---|---|---|
| GET  | `/api/v1/health` | liveness |
| POST | `/api/v1/onboarding/start` | create anonymous user (age-gated), return session + Stream tokens |
| POST | `/api/v1/match` | General → next-available listener + Stream channel |
| POST | `/api/v1/safety/scan` | crisis scan → support-and-refer + helplines, files a safety flag |
| POST | `/api/v1/conversations/{id}/end` | end (messages kept) |
| POST | `/api/v1/conversations/{id}/wipe` | Panda Wipe — real server-side delete |

All but health/onboarding require `Authorization: Bearer <session_token>`.

## Trust & Safety invariants (see root `CLAUDE.md`)
- Age computed server-side; under-`MIN_AGE` is blocked.
- Crisis scan persists the **signal**, never the message body.
- Panda Wipe hard-deletes on Stream's servers; never claim on-device-only storage.
- No phone in the user path; email optional, recovery only.

## Status
First slice, run end-to-end. Matching is now verified on **Postgres** with a concurrency test proving no double-assignment (exactly one of N simultaneous requesters wins a capacity-1 listener; the rest get 503). Personal (directed) matching returns 501 pending the mentor-inbox module.
