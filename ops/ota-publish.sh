#!/usr/bin/env bash
# ops/ota-publish.sh — publish a JS-only update to Mento's self-hosted OTA server (services/ota).
#
#   ops/ota-publish.sh qa   [-m "message"] [--commit <ref>]   # export <ref> (default origin/dev) into
#                                                              # $OTA_DATA_DIR/preview/<runtime>/<new dir>
#   ops/ota-publish.sh prod [-m "message"] [--commit <ref>]   # build the same as a tarball (ref must be on
#                                                              # origin/main; default origin/main); never installs
#   sudo ops/ota-publish.sh --install-prod <tarball> --yes-production
#                                                              # verify + install that tarball into the prod
#                                                              # OTA data dir (/opt/mento-prod/ota-data)
#   ops/ota-publish.sh --rollback <channel> <runtime> [--yes-production]
#                                                              # mark the newest live update ROLLED_BACK
#                                                              # (channel production: root + --yes-production)
#   ops/ota-publish.sh --list <channel> <runtime>              # show published updates, newest first
#
# JS-only guard: an update must run on the native code already in phones. The script hashes the native
# layer of <ref> exactly as ops/qa-apk-poll.sh does (versionCode neutralised) and refuses when that
# differs from the APK on /downloads/ (~/qa-apk-out/state/published_fp). The fix is a new APK:
# merge to dev and let the poller build it (or ops/qa-apk-poll.sh --force), then publish.
# For prod the expected fingerprint is the store build's: OTA_EXPECT_FP, else the file
# /opt/mento-prod/state/store_fp (written when the store build is published; docs/PRODUCTION.md).
# Production updates are built only from commits on origin/main (ops/lib/prod-guards.sh) and
# installed only by root with --yes-production, which re-checks that the commit is on main.
#
# Builds in the shared build checkout ($QA_APK_BUILD_DIR, default ~/aabbuild) under the same lock as
# the APK build, so the two never collide. Secrets: only EXPO_PUBLIC_* values are read (they ship in
# the app by design); nothing is echoed.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
BUILD=${QA_APK_BUILD_DIR:-$HOME/aabbuild}
OUT=${QA_APK_OUT:-$HOME/qa-apk-out}
DATA=${OTA_DATA_DIR:-/srv/mento/ota-data}
PROD_OUT=${OTA_PROD_OUT:-$HOME/ota-out}
QA_ENV=${QA_APK_ENV:-$HOME/.config/mento/qa-build.env}
PROD_ENV=${OTA_PROD_ENV:-$HOME/.config/mento/prod-build.env}
[ -r "$PROD_ENV" ] || PROD_ENV=$REPO/.secrets/prod.env
PROD_DATA=${OTA_PROD_DATA_DIR:-/opt/mento-prod/ota-data}
PROD_FP_FILE=${OTA_PROD_FP_FILE:-/opt/mento-prod/state/store_fp}
SECRETS_QA=${OTA_SECRETS_QA:-$REPO/.secrets/qa.env}
TOKEN='^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'

die() { echo "ota-publish: $1" >&2; exit "${2:-1}"; }
newest_live() { # $1 dir; prints the newest update dir name without ROLLED_BACK
  local d
  for d in $(ls -1 "$1" 2>/dev/null | sort -r); do
    [ -d "$1/$d" ] && [ ! -e "$1/$d/ROLLED_BACK" ] && { echo "$d"; return 0; }
  done
  return 1
}

# shellcheck source=lib/prod-guards.sh
. "$REPO/ops/lib/prod-guards.sh"

case "${1:-}" in
  --install-prod)
    { [ $# -eq 3 ] && [ "$3" = --yes-production ]; } || die "usage: sudo $0 --install-prod <tarball> --yes-production" 2
    [ "$(id -u)" -eq 0 ] || die "--install-prod must run as root" 2
    TAR=$2
    { [ -f "$TAR" ] && [ -f "$TAR.sha256" ]; } || die "need $TAR and $TAR.sha256" 2
    (cd "$(dirname "$TAR")" && sha256sum --quiet -c "$(basename "$TAR").sha256") || die "checksum mismatch"
    STAGE=$(mktemp -d); trap 'rm -rf "$STAGE"' EXIT
    tar -xzf "$TAR" -C "$STAGE" --no-same-owner
    NAME=$(ls -1 "$STAGE")
    { [ "$(printf '%s\n' "$NAME" | wc -l)" = 1 ] && [[ $NAME =~ $TOKEN ]]; } || die "unexpected tarball layout"
    COMMIT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["commit"])' "$STAGE/$NAME/published.json")
    RUNTIME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$STAGE/$NAME/expoConfig.json")
    [[ $RUNTIME =~ $TOKEN ]] || die "odd runtime version $RUNTIME"
    prod_on_main "$REPO" "$COMMIT" >/dev/null || die "refused: the update's commit is not on origin/main"
    dest=$PROD_DATA/production/$RUNTIME
    install -d -m 755 "$dest"
    [ ! -e "$dest/$NAME" ] || die "$NAME is already installed"
    chown -R root:root "$STAGE/$NAME"; chmod -R a+rX,go-w "$STAGE/$NAME"
    mv "$STAGE/$NAME" "$dest/.$NAME.tmp"
    mv "$dest/.$NAME.tmp" "$dest/$NAME"
    printf '%s by=%s installed=%s commit=%s runtime=%s\n' "$(date -u +%FT%TZ)" "${SUDO_USER:-root}" \
      "$NAME" "$COMMIT" "$RUNTIME" >> "$PROD_DATA/install-history.log"
    echo "ota-publish: PRODUCTION update $NAME live for runtime $RUNTIME (commit ${COMMIT:0:12})"
    echo "  roll back: sudo $0 --rollback production $RUNTIME --yes-production"
    exit 0 ;;
  --rollback|--list)
    { [ $# -eq 3 ] || { [ $# -eq 4 ] && [ "$4" = --yes-production ]; }; } \
      || die "usage: $0 $1 <channel> <runtime> [--yes-production]" 2
    [[ $2 =~ $TOKEN && $3 =~ $TOKEN ]] || die "bad channel or runtime" 2
    if [ "$2" = production ]; then
      DATA=$PROD_DATA
      if [ "$1" = --rollback ]; then
        { [ "${4:-}" = --yes-production ] && [ "$(id -u)" -eq 0 ]; } \
          || die "rolling back PRODUCTION needs root and --yes-production" 2
      fi
    fi
    dir=$DATA/$2/$3
    [ -d "$dir" ] || die "nothing published under $dir"
    if [ "$1" = --list ]; then
      for d in $(ls -1 "$dir" | sort -r); do
        msg=$(python3 -c 'import json,sys;p=json.load(open(sys.argv[1]));print(p.get("commit","")[:7],p.get("message",""))' "$dir/$d/published.json" 2>/dev/null || true)
        [ -e "$dir/$d/ROLLED_BACK" ] && state="rolled back" || state="live"
        echo "$d  [$state]  $msg"
      done
      exit 0
    fi
    live=$(newest_live "$dir") || die "no live update under $dir (phones already run the APK's bundle)"
    date -u +%FT%TZ >"$dir/$live/ROLLED_BACK"
    if prev=$(newest_live "$dir"); then
      echo "ota-publish: rolled back $live; phones now get $prev"
    else
      echo "ota-publish: rolled back $live; no live update left, phones are told to return to the APK's bundle"
    fi
    echo "  undo: rm $dir/$live/ROLLED_BACK"
    exit 0 ;;
  qa)   TARGET=qa;   CHANNEL=preview;    VARIANT=preview;    APP_ENV=qa;         API=https://qa-api.mento.chat/api/v1 ;;
  prod) TARGET=prod; CHANNEL=production; VARIANT=production; APP_ENV=production; API=${OTA_PROD_API_URL:-https://api.mento.chat/api/v1} ;;
  *) sed -n '2,10p' "$0" >&2; exit 2 ;;
esac
shift
MESSAGE="" REF=""
while [ $# -gt 0 ]; do
  case "$1" in
    -m) MESSAGE=${2:?-m needs a message}; shift 2 ;;
    --commit) REF=${2:?--commit needs a ref}; shift 2 ;;
    *) die "unknown argument $1" 2 ;;
  esac
done

[ -e "$BUILD/.git" ] || die "$BUILD is not a git checkout" 2
if [ -z "$REF" ]; then
  if [ "$TARGET" = prod ]; then
    git -C "$REPO" fetch -q origin main; REF=origin/main
  else
    git -C "$REPO" fetch -q origin dev; REF=origin/dev
  fi
fi
FULL=$(git -C "$REPO" rev-parse --verify "$REF^{commit}") || die "unknown ref $REF" 2
if [ "$TARGET" = prod ]; then
  PROD_NO_FETCH=1 prod_on_main "$REPO" "$FULL" >/dev/null \
    || die "production updates are built only from commits on origin/main" 2
fi
SHA=${FULL:0:7}

mkdir -p "$OUT"
exec 9>"$OUT/.lock"
flock -n 9 || die "an APK build or another publish is running; try again shortly" 4

if [ "$TARGET" = qa ]; then
  EXPECT_FP=$(cat "$OUT/state/published_fp" 2>/dev/null) || die "no published APK fingerprint in $OUT/state (run ops/qa-apk-poll.sh --seed)" 2
  ENVF=$QA_ENV
else
  EXPECT_FP=${OTA_EXPECT_FP:-$(cat "$PROD_FP_FILE" 2>/dev/null || true)}
  [ -n "$EXPECT_FP" ] || die "no store-build fingerprint: set OTA_EXPECT_FP or write $PROD_FP_FILE" 2
  ENVF=$PROD_ENV
fi
# Optional public build values (Stream key while Stream remains); a missing file is fine.
[ -r "$ENVF" ] || { echo "ota-publish: note: no $ENVF; building without Stream (own chat only)" >&2; ENVF=/dev/null; }

LOG=$OUT/ota-$TARGET-$SHA.log
echo "ota-publish: $TARGET $SHA (log: $LOG)"
git -C "$BUILD" fetch -q "$REPO" "$FULL"
git -C "$BUILD" checkout -q -f --detach "$FULL"
cd "$BUILD/apps/mobile"
env -u NODE_ENV npm ci --no-audit --no-fund >"$LOG" 2>&1 || die "npm ci failed, see $LOG"

# Same recipe as ops/qa-apk-poll.sh, so the hashes are comparable.
sed -i 's/"versionCode": [0-9]*,/"versionCode": 1,/' app.json
FP=$(env -u APP_VARIANT npx --no-install fingerprint fingerprint:generate --platform android 2>>"$LOG" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["hash"])') || FP=""
git checkout -q -- app.json
[ -n "$FP" ] || die "fingerprint failed, see $LOG"
if [ "$FP" != "$EXPECT_FP" ]; then
  echo "ota-publish: REFUSED. $SHA changes the native layer (${FP:0:12}), the APK has ${EXPECT_FP:0:12}." >&2
  echo "  An OTA cannot carry native changes. Ship a new APK first: merge to dev and let the" >&2
  echo "  APK poller build it (or ops/qa-apk-poll.sh --force); then publish again." >&2
  exit 5
fi

RUNTIME=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["expo"]["version"])' app.json)
[[ $RUNTIME =~ $TOKEN ]] || die "odd runtime version $RUNTIME"

# Public build values only: EXPO_PUBLIC_* lines, never echoed.
pub() { local key=$1; shift; grep -h "^$key=" "$@" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true; }
export EXPO_NO_DOTENV=1 APP_VARIANT=$VARIANT EXPO_PUBLIC_APP_ENV=$APP_ENV EXPO_PUBLIC_API_URL=$API \
  EXPO_PUBLIC_OWN_CHAT_ACCEPTED=1 EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED=1 \
  EXPO_PUBLIC_GIT_SHA=$SHA CI=1
EXPO_PUBLIC_STREAM_API_KEY=$(pub EXPO_PUBLIC_STREAM_API_KEY "$ENVF")
[ -n "$EXPO_PUBLIC_STREAM_API_KEY" ] || echo "ota-publish: warning: no EXPO_PUBLIC_STREAM_API_KEY; Stream rooms will not open in this update" >&2
export EXPO_PUBLIC_STREAM_API_KEY
if [ "$TARGET" = qa ] && [ -r "$SECRETS_QA" ]; then
  EXPO_PUBLIC_SENTRY_DSN=$(pub EXPO_PUBLIC_SENTRY_DSN "$SECRETS_QA")
else
  EXPO_PUBLIC_SENTRY_DSN=$(pub EXPO_PUBLIC_SENTRY_DSN "$ENVF")
fi
export EXPO_PUBLIC_SENTRY_DSN

NAME=$(date -u +%Y%m%dT%H%M%SZ)-$SHA
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/ota-$TARGET-XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
PLATFORMS=${OTA_PLATFORMS:-android ios}
args=(); for p in $PLATFORMS; do args+=(--platform "$p"); done
NODE_ENV=production npx expo export "${args[@]}" --dump-assetmap --output-dir "$STAGE/$NAME" >>"$LOG" 2>&1 \
  || die "expo export failed, see $LOG"
[ -s "$STAGE/$NAME/metadata.json" ] || die "export wrote no metadata.json"
NODE_ENV=production npx expo config --type public --json >"$STAGE/$NAME/expoConfig.json" 2>>"$LOG" \
  || die "expo config failed, see $LOG"
python3 - "$STAGE/$NAME/published.json" "$FULL" "$MESSAGE" "$FP" "$PLATFORMS" <<'PY'
import json, sys
from datetime import UTC, datetime
path, commit, message, fp, platforms = sys.argv[1:]
json.dump({"createdAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"), "commit": commit,
           "message": message, "fingerprint": fp, "platforms": platforms.split()}, open(path, "w"))
PY
chmod -R a+rX,go-w "$STAGE/$NAME"

if [ "$TARGET" = qa ]; then
  dest=$DATA/$CHANNEL/$RUNTIME
  mkdir -p "$dest"
  # Copy beside the target, then rename: the server never sees a half-written update.
  cp -r "$STAGE/$NAME" "$dest/.$NAME.tmp"
  mv "$dest/.$NAME.tmp" "$dest/$NAME"
  echo "ota-publish: published $NAME to $CHANNEL / runtime $RUNTIME${MESSAGE:+ ($MESSAGE)}"
  echo "  phones pick it up on next launch (then relaunch) or Profile > Check for updates"
  echo "  roll back: ops/ota-publish.sh --rollback $CHANNEL $RUNTIME"
else
  mkdir -p "$PROD_OUT"
  TAR=$PROD_OUT/ota-production-$RUNTIME-$NAME.tar.gz
  tar -czf "$TAR" -C "$STAGE" "$NAME"
  (cd "$PROD_OUT" && sha256sum "$(basename "$TAR")" >"$(basename "$TAR").sha256")
  echo "ota-publish: built $TAR (not installed)"
  echo "  install it (root, only when the founder asks):"
  echo "    sudo $0 --install-prod $TAR --yes-production"
fi
