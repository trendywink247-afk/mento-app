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
In dev with `ENV=dev`, tables are auto-created from the models and Stream calls degrade to safe stubs (no Stream creds needed to exercise onboarding/match). Use Alembic for staging/prod.

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
First slice. **Not yet run/verified** (Python not installed on the authoring machine). Review before trusting. Personal (directed) matching returns 501 pending the mentor-inbox module.
