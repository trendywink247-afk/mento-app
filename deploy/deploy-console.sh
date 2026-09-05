#!/usr/bin/env bash
# Run LOCALLY (on the dev machine, from repo root) to build and ship the admin
# dashboard + listener console to the VPS. Unlike deploy.sh, this does NOT run
# on the VPS: the box is a 1-2GB Debian VPS and can't reliably run the
# Expo/Metro toolchain (large node_modules, memory-hungry bundler). The static
# build itself is tiny; only the BUILD step needs a real machine.
#
#   ./deploy/deploy-console.sh
set -euo pipefail

VPS_HOST="mento-ops@87.232.72.79"
REMOTE_BASE="/opt/mento-console"

cd "$(dirname "${BASH_SOURCE[0]}")/../apps/mobile"

if [ ! -f .env.production ]; then
    echo "[deploy-console] missing apps/mobile/.env.production — see .env.example for the shape; needs EXPO_PUBLIC_API_URL=https://api.agentin.chat/api/v1 + the prod EXPO_PUBLIC_STREAM_API_KEY." >&2
    exit 1
fi

echo "[deploy-console] building static web export (prod env)..."
rm -rf dist
npx expo export --platform web

echo "[deploy-console] uploading..."
# tar stream, not `scp -r`: on Windows OpenSSH `scp -r dist host:new` races its own
# directory creation ("remote setstat … No such file or directory") and leaves a
# partial upload (session 31f). tar is atomic per file and exits non-zero on failure.
ssh "$VPS_HOST" "rm -rf ${REMOTE_BASE}/new && mkdir -p ${REMOTE_BASE}/new"
tar -C dist -cf - . | ssh "$VPS_HOST" "tar -C ${REMOTE_BASE}/new -xf -"

echo "[deploy-console] swapping in atomically..."
ssh "$VPS_HOST" "
set -e
cd ${REMOTE_BASE}
rm -rf old
[ -d current ] && mv current old || true
mv new current
"

echo "[deploy-console] verifying..."
sleep 1
for path in /admin /listener /apply; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "https://console.agentin.chat${path}")
    if [ "$code" != "200" ]; then
        echo "[deploy-console] FAILED — https://console.agentin.chat${path} returned ${code} (expected 200)" >&2
        exit 1
    fi
    echo "[deploy-console] ${path} -> ${code}"
done

echo "[deploy-console] done."
