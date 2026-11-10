#!/usr/bin/env bash
# Keep the QA APK on https://qa-api.mento.chat/downloads/ in step with dev, without anyone running anything.
#
# Why a fingerprint: JS changes reach phones over the air, so they need no new APK. A new native module,
# permission or SDK needs one, and runtimeVersion is the app version ("appVersion" policy), so an
# old APK would otherwise be handed JS that expects native code it does not have. @expo/fingerprint hashes
# exactly the native layer; the APK is rebuilt only when that hash differs from the one last published.
#
#   ops/qa-apk-poll.sh            # check origin/dev; build + publish only if the native fingerprint changed
#   ops/qa-apk-poll.sh --force    # build + publish origin/dev now, whatever the fingerprint says
#   ops/qa-apk-poll.sh --status   # print the published and current fingerprints, build nothing
#   ops/qa-apk-poll.sh --seed     # record the build checkout's fingerprint as "published" (once, after a manual publish)
#
# Runs as the repo owner (agent) from infra/systemd/mento-qa-apk-poll.timer. Publishing uses the
# root helper infra/qa-agent/apk-publish.sh through sudo (README there). versionCode is the last
# published one + 1, set in the build checkout only, so no bump commit is needed.
# A failed build is remembered per fingerprint, so a broken change is not rebuilt every tick;
# fix it (the fingerprint changes) or run --force. The previous APK stays live on any failure.
set -uo pipefail

REPO="${POLL_REPO:-/srv/mento/mento-app}"
BUILD="${QA_APK_BUILD_DIR:-$HOME/aabbuild}"
OUT="${QA_APK_OUT:-$HOME/qa-apk-out}"
STATE="$OUT/state"
mkdir -p "$STATE" "$OUT/failed"
exec 7>"$OUT/.poll.lock"
flock -n 7 || { echo "qa-apk-poll: another poll is running"; exit 0; }

fingerprint() { # $1 = full sha; prints the native fingerprint with versionCode neutralised
  exec 9>"$OUT/.lock"
  flock -n 9 || { echo "busy" >&2; return 4; }
  git -C "$BUILD" checkout -q -f --detach "$1" || return 1
  (
    cd "$BUILD/apps/mobile" || exit 1
    sed -i 's/"versionCode": [0-9]*,/"versionCode": 1,/' app.json
    npx --no-install fingerprint fingerprint:generate --platform android 2>/dev/null \
      | python3 -c 'import sys,json; print(json.load(sys.stdin)["hash"])'
    git checkout -q -- app.json
  )
  rc=$?
  exec 9>&-
  return $rc
}

git -C "$REPO" fetch -q origin dev || { echo "qa-apk-poll: fetch failed" >&2; exit 1; }
HEAD_SHA=$(git -C "$REPO" rev-parse origin/dev)
git -C "$BUILD" fetch -q "$REPO" "$HEAD_SHA" 2>/dev/null

case "${1:-}" in
  --seed)
    code=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["expo"]["android"]["versionCode"])' "$BUILD/apps/mobile/app.json")
    sha=$(git -C "$BUILD" rev-parse HEAD)
    fp=$(fingerprint "$sha") || { echo "qa-apk-poll: fingerprint failed" >&2; exit 1; }
    echo "$fp" >"$STATE/published_fp"; echo "$code" >"$STATE/published_code"
    echo "qa-apk-poll: seeded fingerprint ${fp:0:12} at build $code ($sha)"; exit 0 ;;
esac

fp=$(fingerprint "$HEAD_SHA"); rc=$?
[ "$rc" -eq 4 ] && { echo "qa-apk-poll: a build is running; next tick"; exit 0; }
[ "$rc" -eq 0 ] && [ -n "$fp" ] || { echo "qa-apk-poll: fingerprint failed" >&2; exit 1; }
pub_fp=$(cat "$STATE/published_fp" 2>/dev/null || echo none)
pub_code=$(cat "$STATE/published_code" 2>/dev/null || echo 0)

if [ "${1:-}" = "--status" ]; then
  echo "dev ${HEAD_SHA:0:7}  native fingerprint ${fp:0:12}"
  echo "published build $pub_code  fingerprint ${pub_fp:0:12}"
  [ "$fp" = "$pub_fp" ] && echo "up to date" || echo "APK is behind: a rebuild is due"
  exit 0
fi

if [ "${1:-}" != "--force" ]; then
  [ "$fp" = "$pub_fp" ] && { echo "qa-apk-poll: APK is current (${fp:0:12}, build $pub_code)"; exit 0; }
  [ -e "$OUT/failed/$fp" ] && { echo "qa-apk-poll: this change failed before ($(cat "$OUT/failed/$fp")); fix it or run --force"; exit 0; }
fi

next=$((pub_code + 1))
echo "qa-apk-poll: native layer changed (${pub_fp:0:12} -> ${fp:0:12}); building ${HEAD_SHA:0:7} as build $next"
if ! QA_APK_BUMP_TO=$next "$REPO/ops/qa-apk.sh" "$HEAD_SHA"; then
  echo "${HEAD_SHA:0:7} $(date -u +%FT%TZ)" >"$OUT/failed/$fp"
  echo "qa-apk-poll: build failed; the previous APK stays live" >&2; exit 1
fi
if ! sudo -n /usr/local/sbin/qa-agent/apk-publish.sh; then
  echo "qa-apk-poll: staged but not published (sudo helper missing?); see infra/qa-agent/README.md" >&2; exit 1
fi
if curl -fsS https://qa-api.mento.chat/downloads/ | grep -q "build $next, ${HEAD_SHA:0:7}"; then
  echo "$fp" >"$STATE/published_fp"; echo "$next" >"$STATE/published_code"
  echo "qa-apk-poll: published build $next (${HEAD_SHA:0:7}); fingerprint ${fp:0:12}"
else
  echo "qa-apk-poll: installed but the page does not show build $next" >&2; exit 1
fi
