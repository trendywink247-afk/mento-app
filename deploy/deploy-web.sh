#!/usr/bin/env bash
# Run LOCALLY (on the dev machine, from repo root) to build and ship the web build
# — the one SPA behind the app host AND the admin host — to the VPS. Unlike
# deploy.sh, this does NOT run on the VPS: the box is a 1-2GB Debian VPS and can't
# reliably run the Expo/Metro toolchain (large node_modules, memory-hungry
# bundler). The static build itself is tiny; only the BUILD step needs a real
# machine. Hostnames + SSH target come from deploy/domains.env.
#
#   ./deploy/deploy-web.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck source=domains.env
. "$HERE/domains.env"
set +a
REMOTE_BASE="/opt/mento-console"   # directory name predates the host split; Nginx roots point here

cd "$HERE/../apps/mobile"

if [ ! -f .env.production ]; then
    echo "[deploy-web] missing apps/mobile/.env.production — see .env.example for the shape; needs EXPO_PUBLIC_API_URL=https://${API_HOST}/api/v1 + the prod EXPO_PUBLIC_STREAM_API_KEY." >&2
    exit 1
fi

echo "[deploy-web] building static web export (prod env)..."
rm -rf dist
npx expo export --platform web

echo "[deploy-web] uploading..."
# tar stream, not `scp -r`: on Windows OpenSSH `scp -r dist host:new` races its own
# directory creation ("remote setstat … No such file or directory") and leaves a
# partial upload (session 31f). tar is atomic per file and exits non-zero on failure.
ssh "$VPS_SSH" "rm -rf ${REMOTE_BASE}/new && mkdir -p ${REMOTE_BASE}/new"
tar -C dist -cf - . | ssh "$VPS_SSH" "tar -C ${REMOTE_BASE}/new -xf -"

echo "[deploy-web] swapping in atomically..."
ssh "$VPS_SSH" "
set -e
cd ${REMOTE_BASE}
rm -rf old
[ -d current ] && mv current old || true
mv new current
"

echo "[deploy-web] verifying..."
sleep 1
fail=0
check() {
    local url=$1 want=$2 code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
    if [ "$code" != "$want" ]; then
        echo "[deploy-web] FAILED — $url returned $code (expected $want)" >&2
        fail=1
    else
        echo "[deploy-web] $url -> $code"
    fi
}
check "https://${APP_HOST}/" 200
check "https://${APP_HOST}/onboarding" 200
check "https://${APP_HOST}/apply" 200
check "https://${APP_HOST}/admin" 404
check "https://${ADMIN_HOST}/admin" 200
[ "$fail" -eq 0 ] || exit 1

echo "[deploy-web] done."
