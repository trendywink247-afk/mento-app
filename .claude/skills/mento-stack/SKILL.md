---
name: mento-stack
description: Use when starting a Mento session, when the app or API must run, or when endpoints 404, matching 503s, or ports 8000/8081 seem stale or occupied.
---

# Mento dev stack — start & repair

## Start (backend first, PowerShell)

```powershell
cd services/api
docker compose up -d --wait                                  # mento-postgres :5432 + mento-redis :6379
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.seed_listeners         # without this, matching 503s
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000   # Swagger /docs

cd apps/mobile
npx expo start --web --port 8081     # add -c after any dependency change
```

Docker Desktop itself may be down — `docker compose` failing with a pipe/daemon error means start Docker Desktop first, then retry.

## Health checks

- API: `http://localhost:8000/docs` loads; `GET /api/v1/health` ok.
- Web: `http://localhost:8081` renders the landing.

## Repair table (symptom → cause → fix)

| Symptom | Cause | Fix |
|---|---|---|
| New endpoint 404s (`{"detail":"Not Found"}`) | **Stale uvicorn** started before the router existed | Kill :8000 and restart uvicorn |
| New `app/` route not found by expo-router | Route typegen needs a dev-server restart | Restart `expo start` |
| Matching returns 503 | Listeners table empty (pytest truncation) or capacity exhausted | Re-seed; if E2E-related see **mento-e2e** reset |
| Onboarding 429 | Rate limit 10/h per IP hit (usually by E2E runs) | `docker exec mento-redis redis-cli FLUSHDB` |
| Bundler serves stale/broken modules | Metro cache after dep change | `npx expo start --web --port 8081 -c` |

Kill a stuck port (8000 shown; same for 8081):

```powershell
$c = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($c) { $c.OwningProcess | Select-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force } }
```

Output when done: both URLs verified loading, plus any repair performed.
