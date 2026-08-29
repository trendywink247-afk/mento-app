#!/usr/bin/env bash
# Run ON the VPS, from the repo root (e.g. /opt/mento), to ship the latest
# committed code to prod. Idempotent: safe to re-run.
#
#   ssh mento-vps 'cd /opt/mento && ./deploy/deploy.sh'
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[deploy] fetching latest..."
git fetch origin
git reset --hard origin/master

echo "[deploy] building api image..."
docker compose -f deploy/docker-compose.prod.yml build api

echo "[deploy] starting stack (migrations run automatically on api boot)..."
docker compose -f deploy/docker-compose.prod.yml up -d

echo "[deploy] waiting for health..."
for i in $(seq 1 30); do
    if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
        echo "[deploy] healthy."
        exit 0
    fi
    sleep 2
done

echo "[deploy] FAILED — /api/v1/health never came up. Check: docker compose -f deploy/docker-compose.prod.yml logs api" >&2
exit 1
