#!/bin/sh
# Serve only. Migrations are NOT run here: a serving container that migrates on boot
# would race its sibling colour during a blue/green swap and could leave a half-
# applied schema behind a container that is already taking traffic. deploy/deploy.sh
# runs them first, as a one-off (`alembic upgrade head` through this same entrypoint's
# one-off mode), and starts no new container unless they succeed.
set -e

# One-off mode: any args (deploy.sh's migration step, deploy/do-app.yaml's PRE_DEPLOY
# migrate job, an ad-hoc script) run INSTEAD of serving.
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

WORKERS="${UVICORN_WORKERS:-2}"
PORT="${PORT:-8000}"
echo "[entrypoint] starting uvicorn with ${WORKERS} worker(s) on :${PORT}"
# --ws-max-size: own-chat frames are capped at 16 KB (WS5 T5.3); the app checks it too.
# --ws-ping-*: the live events socket (docs/LIVE_EVENTS.md) is kept open by protocol pings
# (a few bytes, no app code); a peer that does not answer within 20 s is closed.
# --no-access-log: app/observability.py already writes one scrubbed line per request (mento.access,
# no IPs, no query strings). Uvicorn's own access log duplicated every line and carries client
# addresses, which the privacy policy says we do not keep.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT}" --workers "${WORKERS}" --proxy-headers \
  --ws-max-size 16384 --ws-ping-interval 25 --ws-ping-timeout 20 --no-access-log
