#!/bin/sh
# Migrations-on-deploy: bring the schema to head, then serve.
# Fails hard (set -e) if migrations fail — never serve against a stale schema.
set -e

echo "[entrypoint] running alembic upgrade head..."
alembic upgrade head

WORKERS="${UVICORN_WORKERS:-2}"
PORT="${PORT:-8000}"
echo "[entrypoint] starting uvicorn with ${WORKERS} worker(s) on :${PORT}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --workers "${WORKERS}" --proxy-headers
