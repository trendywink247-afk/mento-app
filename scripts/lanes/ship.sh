#!/usr/bin/env bash
# One command: gate → push → back up prod → deploy the API → deploy the web → publish the OTA.
#
#   bash scripts/lanes/ship.sh "what changed"          # fast gate, then ship
#   MENTO_TIER=full bash scripts/lanes/ship.sh "..."   # full gate first
#   MENTO_SKIP_GATE=1 bash scripts/lanes/ship.sh "..." # the gate already passed in this state
#
# Stops at the first failure and says what it did. Never skips the database backup.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MSG="${1:?a one-line message for the phone update}"
VPS="mento-ops@87.232.72.79"
step() { echo; echo "=== $*"; }
die() { echo "STOPPED: $*" >&2; exit 1; }

cd "$ROOT"
[ -z "$(git status --porcelain)" ] || die "the working tree is dirty — commit first"

if [ -z "${MENTO_SKIP_GATE:-}" ]; then
  step "gate (${MENTO_TIER:-fast})"
  bash scripts/lanes/gate.sh "${MENTO_TIER:-fast}" || die "the gate failed — see the summary above"
fi

step "push"
git push origin master || die "push failed"

step "prod: backup, then deploy the API"
ssh -o BatchMode=yes -o ConnectTimeout=20 "$VPS" \
  'cd /opt/mento && ./deploy/backup-postgres.sh 2>&1 | tail -1 && ./deploy/deploy.sh 2>&1 | tail -2' \
  || die "the API deploy failed (the backup line above says whether it was taken)"
for u in health health/ready; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://api.agentin.chat/api/v1/$u")
  [ "$code" = 200 ] || die "prod $u answered $code"
  echo "prod $u ok"
done

step "prod: the web build"
env -u EXPO_PUBLIC_API_URL -u CI ./deploy/deploy-web.sh 2>&1 | grep "deploy-web\]" | tail -6 \
  || die "the web deploy failed"

step "phone: the OTA"
( cd apps/mobile && env -u EXPO_PUBLIC_API_URL -u CI NODE_ENV=production \
    npx eas-cli update --branch preview --message "$MSG" --non-interactive 2>&1 \
    | grep -E "Android update ID|Commit|Published" ) || die "the OTA failed"

echo; echo "SHIPPED — commit $(git rev-parse --short HEAD). Phone: shake, or Profile → Check for updates."
