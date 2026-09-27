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
step() { echo; echo "=== $*"; }
die() { echo "STOPPED: $*" >&2; exit 1; }

cd "$ROOT"
# shellcheck source=../../deploy/domains.env
. deploy/domains.env
VPS="$VPS_SSH"
[ -z "$(git status --porcelain)" ] || die "the working tree is dirty — commit first"
# Pin the commit this run is shipping. The steps below take minutes, and anything committed
# into that window would otherwise be picked up by `eas update`, which bundles the working
# tree as it stands when IT runs — not what the run started with. That is how an ungated
# commit reached the founder's phone on 20 Sep while the API and web got the previous one.
SHIP_SHA="$(git rev-parse HEAD)"
assert_unmoved() {
  [ -z "$(git status --porcelain)" ] || die "the tree changed mid-ship — nothing further sent"
  [ "$(git rev-parse HEAD)" = "$SHIP_SHA" ]     || die "HEAD moved mid-ship ($SHIP_SHA -> $(git rev-parse --short HEAD)) — nothing further sent"
}

if [ -z "${MENTO_SKIP_GATE:-}" ]; then
  step "gate (${MENTO_TIER:-fast})"
  bash scripts/lanes/gate.sh "${MENTO_TIER:-fast}" || die "the gate failed — see the summary above"
fi

step "push"
git push origin master || die "push failed"

step "prod: backup, then deploy the API"
# The box's checkout moves to SHIP_SHA BEFORE deploy.sh runs, so the deploy.sh that
# runs is the one being shipped (a script that `git reset`s itself mid-run would
# otherwise finish as a mix of old and new lines), and it deploys exactly SHIP_SHA —
# never whatever origin/master became in the meantime. `--backup` takes the database
# backup first and deploys nothing if it fails; pipefail keeps `| tail` from turning
# a failed backup or deploy into a success (it used to).
ssh -o BatchMode=yes -o ConnectTimeout=20 "$VPS" \
  "cd /opt/mento && git fetch -q origin && git reset -q --hard $SHIP_SHA \
   && bash -o pipefail -c './deploy/deploy.sh --backup $SHIP_SHA 2>&1 | tail -6'" \
  || die "the API deploy failed (its last lines are above; nothing after it was shipped)"
for u in health health/ready; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://${API_HOST}/api/v1/$u")
  [ "$code" = 200 ] || die "prod $u answered $code"
  echo "prod $u ok"
done

step "prod: the web build"
assert_unmoved
env -u EXPO_PUBLIC_API_URL -u CI ./deploy/deploy-web.sh 2>&1 | grep "deploy-web\]" | tail -6 \
  || die "the web deploy failed"

step "phone: the OTA"
assert_unmoved
( cd apps/mobile && env -u EXPO_PUBLIC_API_URL -u CI NODE_ENV=production \
    npx eas-cli update --branch preview --message "$MSG" --non-interactive 2>&1 \
    | grep -E "Android update ID|Commit|Published" ) || die "the OTA failed"

echo; echo "SHIPPED — commit $(git rev-parse --short HEAD). Phone: shake, or Profile → Check for updates."
