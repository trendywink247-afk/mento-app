#!/usr/bin/env bash
# ops/build-ios.sh <qa|prod> [options] — build a signed iOS app on the remote Mac over SSH and
# fetch the .ipa back here. No cloud build service. docs/BUILDS.md has the prerequisites.
#
#   --check              only verify the Mac: ssh, macOS, Xcode, CocoaPods, Node, npm
#   --dry-run            print the plan, touch nothing (no ssh)
#   --sha <commit>       commit to build (default HEAD of this repo)
#   --build-number <n>   set ios.buildNumber in the copy sent to the Mac (repo untouched)
#   --out-dir <dir>      where the .ipa lands (default ~/build-out/<env>)
#
# The Mac comes from .secrets/mac.env: MAC_SSH_HOST, MAC_SSH_USER, MAC_SSH_KEY (path on this box),
# optional MAC_SSH_PORT, MAC_WORKDIR (on the Mac), APPLE_TEAM_ID, optional IOS_EXPORT_METHOD,
# MAC_KEYCHAIN_PASSWORD, APPLE_API_KEY_PATH / APPLE_API_KEY_ID / APPLE_API_ISSUER (App Store Connect
# key on the Mac, for signing without an interactive Xcode login). None of these values is printed.
set -euo pipefail

usage() { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

ENV_NAME=${1:-}
case $ENV_NAME in qa | prod) shift ;; *) usage ;; esac

REPO=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=ops/lib/build-env.sh
. "$REPO/ops/lib/build-env.sh"

REF=HEAD CHECK=0 DRY=0 BUILDNO= OUTDIR=
while [ $# -gt 0 ]; do
  case $1 in
    --check) CHECK=1; shift ;;
    --dry-run) DRY=1; shift ;;
    --sha) REF=${2:?--sha needs a commit}; shift 2 ;;
    --build-number) BUILDNO=${2:?}; shift 2 ;;
    --out-dir) OUTDIR=${2:?}; shift 2 ;;
    *) usage ;;
  esac
done
[ -z "$BUILDNO" ] || [[ $BUILDNO =~ ^[0-9]+$ ]] || { echo "build-ios: --build-number must be a number" >&2; exit 2; }

MAC_ENV=$MENTO_SECRETS/mac.env
MAC_SSH_HOST= MAC_SSH_USER= MAC_SSH_KEY= MAC_SSH_PORT= MAC_WORKDIR= APPLE_TEAM_ID= IOS_EXPORT_METHOD=
MAC_KEYCHAIN_PASSWORD= APPLE_API_KEY_PATH= APPLE_API_KEY_ID= APPLE_API_ISSUER=
mento_load_secrets "$MAC_ENV" MAC_SSH_HOST MAC_SSH_USER MAC_SSH_KEY MAC_SSH_PORT MAC_WORKDIR APPLE_TEAM_ID \
  IOS_EXPORT_METHOD MAC_KEYCHAIN_PASSWORD APPLE_API_KEY_PATH APPLE_API_KEY_ID APPLE_API_ISSUER
MAC_WORKDIR=${MAC_WORKDIR:-mento-builds}
METHOD=${IOS_EXPORT_METHOD:-$([ "$ENV_NAME" = prod ] && echo app-store || echo ad-hoc)}

FULL=$(git -C "$REPO" rev-parse --verify "$REF^{commit}")
SHA=${FULL:0:7}
OUTDIR=${OUTDIR:-$HOME/build-out/$ENV_NAME}
REMOTE_DIR=$MAC_WORKDIR/mento-$ENV_NAME-$SHA

if [ "$DRY" = 1 ]; then
  cat <<PLAN
build-ios (dry run): $ENV_NAME at $SHA, export method $METHOD
  1. git archive $SHA into a local staging folder$([ -n "$BUILDNO" ] && echo ", ios.buildNumber=$BUILDNO")
  2. write build.env (mode 600: public EXPO_PUBLIC_* settings, Sentry keys if present) and ExportOptions.plist
  3. rsync to the Mac from .secrets/mac.env: <MAC_WORKDIR>/mento-$ENV_NAME-$SHA
  4. on the Mac: npm ci, expo prebuild --platform ios, pod install, xcodebuild archive, exportArchive
     (Sentry dSYM + sourcemap upload only if SENTRY_AUTH_TOKEN is set); build.env deleted after reading
  5. fetch the .ipa to $OUTDIR/mento-$ENV_NAME-<version>-<build>-$SHA.ipa (+ .sha256) and the build log
mac.env present: $([ -r "$MAC_ENV" ] && echo yes || echo no)
PLAN
  exit 0
fi

for k in MAC_SSH_HOST MAC_SSH_USER MAC_SSH_KEY; do
  [ -n "${!k}" ] || { echo "build-ios: $k missing from $MAC_ENV (docs/BUILDS.md)" >&2; exit 3; }
done
[ -r "$MAC_SSH_KEY" ] || { echo "build-ios: MAC_SSH_KEY in $MAC_ENV is not a readable file" >&2; exit 3; }
SSH_OPTS=(-i "$MAC_SSH_KEY" -p "${MAC_SSH_PORT:-22}" -o BatchMode=yes -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15 -o LogLevel=ERROR)
TARGET=$MAC_SSH_USER@$MAC_SSH_HOST
mac() { ssh "${SSH_OPTS[@]}" "$TARGET" "$@"; }
# Non-login ssh shells on macOS lack Homebrew's PATH.
REMOTE_PATH='export PATH=/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/current/bin:$PATH'

if [ "$CHECK" = 1 ]; then
  echo "build-ios: checking the Mac from .secrets/mac.env"
  # shellcheck disable=SC2016  # expanded on the Mac
  mac "$REMOTE_PATH"'
    ok=0
    printf "macOS      %s\n" "$(sw_vers -productVersion 2>/dev/null || echo MISSING)"
    printf "Xcode      %s\n" "$(xcodebuild -version 2>/dev/null | head -1 || true)"; xcodebuild -version >/dev/null 2>&1 || ok=1
    printf "CocoaPods  %s\n" "$(pod --version 2>/dev/null || echo MISSING)"; command -v pod >/dev/null || ok=1
    printf "Node       %s\n" "$(node --version 2>/dev/null || echo MISSING)"; command -v node >/dev/null || ok=1
    printf "npm        %s\n" "$(npm --version 2>/dev/null || echo MISSING)"; command -v npm >/dev/null || ok=1
    printf "rsync      %s\n" "$(command -v rsync >/dev/null && echo present || echo MISSING)"; command -v rsync >/dev/null || ok=1
    exit $ok' || { echo "build-ios: the Mac is not ready (or ssh failed)" >&2; exit 1; }
  [ -n "$APPLE_TEAM_ID" ] || echo "build-ios: note: APPLE_TEAM_ID is not set in mac.env; a build will refuse"
  echo "build-ios: the Mac is ready"
  exit 0
fi

[ -n "$APPLE_TEAM_ID" ] || { echo "build-ios: APPLE_TEAM_ID missing from $MAC_ENV" >&2; exit 3; }
mkdir -p "$OUTDIR"
STAGE=$(mktemp -d "${TMPDIR:-/tmp}/mento-ios-XXXXXX")
trap 'rm -rf "$STAGE"' EXIT
chmod 700 "$STAGE"
mkdir -p "$STAGE/src"
git -C "$REPO" archive "$FULL" | tar -x -C "$STAGE/src"
APPJSON=$STAGE/src/apps/mobile/app.json
if [ -n "$BUILDNO" ]; then
  python3 -c 'import json,sys
p=sys.argv[1]; d=json.load(open(p)); d["expo"].setdefault("ios",{})["buildNumber"]=sys.argv[2]
open(p,"w").write(json.dumps(d,indent=2,ensure_ascii=False)+"\n")' "$APPJSON" "$BUILDNO"
fi
if [ "$ENV_NAME" = prod ] && [ ! -s "$STAGE/src/apps/mobile/certs/ota-prod.pem" ]; then
  echo "build-ios: apps/mobile/certs/ota-prod.pem is missing at $SHA (docs/OTA.md)" >&2; exit 3
fi
VERSION=$(mento_app_json "$APPJSON" expo.version)
BUILD_NUMBER=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["expo"].get("ios",{}).get("buildNumber","1"))' "$APPJSON")

# build.env: read once on the Mac, then deleted there. Values quoted with %q, never printed.
(
  mento_build_env "$ENV_NAME" "$SHA" || exit 3
  umask 077
  for k in APP_VARIANT EXPO_PUBLIC_APP_ENV EXPO_PUBLIC_API_URL EXPO_NO_DOTENV CI EXPO_PUBLIC_PUSH_DIRECT \
      EXPO_PUBLIC_OWN_CHAT_ACCEPTED EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED EXPO_PUBLIC_GIT_SHA \
      EXPO_PUBLIC_STREAM_API_KEY EXPO_PUBLIC_SENTRY_DSN SENTRY_DISABLE_AUTO_UPLOAD SENTRY_AUTH_TOKEN SENTRY_ORG \
      SENTRY_PROJECT SENTRY_URL APPLE_TEAM_ID MAC_KEYCHAIN_PASSWORD APPLE_API_KEY_PATH APPLE_API_KEY_ID \
      APPLE_API_ISSUER; do
    [ -z "${!k:-}" ] || printf 'export %s=%q\n' "$k" "${!k}"
  done >"$STAGE/build.env"
  printf 'export MENTO_SHA=%q MENTO_DIST=%q\n' "$SHA" "$BUILD_NUMBER" >>"$STAGE/build.env"
) || { echo "build-ios: build settings incomplete (see the message above)" >&2; exit 3; }
sed "s/@METHOD@/$METHOD/; s/@TEAM_ID@/$APPLE_TEAM_ID/" "$REPO/ops/ios/ExportOptions.plist.tmpl" >"$STAGE/ExportOptions.plist"

LOG=$OUTDIR/build-ios-$SHA.log
echo "build-ios: $ENV_NAME $SHA ($METHOD) on the Mac (log: $LOG)"
mac "mkdir -p '$REMOTE_DIR'"
rsync -az --delete -e "ssh ${SSH_OPTS[*]}" "$STAGE"/ "$TARGET:$REMOTE_DIR/"

# shellcheck disable=SC2016  # the whole script runs on the Mac
REMOTE_SCRIPT='
set -euo pipefail
cd "$1"
trap "rm -f \"$1/build.env\"" EXIT
. ./build.env; rm -f build.env
'"$REMOTE_PATH"'
if [ -n "${MAC_KEYCHAIN_PASSWORD:-}" ]; then security unlock-keychain -p "$MAC_KEYCHAIN_PASSWORD" login.keychain-db; fi
unset MAC_KEYCHAIN_PASSWORD
AUTH=()
if [ -n "${APPLE_API_KEY_PATH:-}" ]; then
  AUTH=(-authenticationKeyPath "$APPLE_API_KEY_PATH" -authenticationKeyID "$APPLE_API_KEY_ID" -authenticationKeyIssuerID "$APPLE_API_ISSUER")
fi
OUT="$PWD/build"; rm -rf "$OUT"; mkdir -p "$OUT"
cd src/apps/mobile
env -u NODE_ENV npm ci --no-audit --no-fund
NODE_ENV=production npx expo prebuild --platform ios --clean --no-install
(cd ios && pod install)
WS=$(ls -d ios/*.xcworkspace | head -1); SCHEME=$(basename "$WS" .xcworkspace)
export SOURCEMAP_FILE="$OUT/main.jsbundle.map"
NODE_ENV=production xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release \
  -destination generic/platform=iOS -archivePath "$OUT/Mento.xcarchive" archive \
  DEVELOPMENT_TEAM="$APPLE_TEAM_ID" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
xcodebuild -exportArchive -archivePath "$OUT/Mento.xcarchive" -exportOptionsPlist "$1/ExportOptions.plist" \
  -exportPath "$OUT/ipa" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}
if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ -n "${SENTRY_ORG:-}" ] && [ -n "${SENTRY_PROJECT:-}" ]; then
  CLI=node_modules/.bin/sentry-cli
  APPDIR=$(ls -d "$OUT"/Mento.xcarchive/Products/Applications/*.app | head -1)
  if "$CLI" releases new "$MENTO_SHA" \
     && "$CLI" sourcemaps upload --release "$MENTO_SHA" --dist "$MENTO_DIST" "$APPDIR/main.jsbundle" "$SOURCEMAP_FILE" \
     && "$CLI" debug-files upload "$OUT/Mento.xcarchive/dSYMs" \
     && "$CLI" releases finalize "$MENTO_SHA"; then
    echo "SENTRY_UPLOAD=ok"
  else
    echo "SENTRY_UPLOAD=failed"
  fi
fi
ls "$OUT"/ipa/*.ipa
'
set +e
# shellcheck disable=SC2029  # REMOTE_DIR is meant to expand here
mac "bash -s -- '$REMOTE_DIR'" <<<"$REMOTE_SCRIPT" >"$LOG" 2>&1
RC=$?
set -e
[ "$RC" = 0 ] || { echo "build-ios: build FAILED on the Mac, see $LOG" >&2; tail -20 "$LOG" >&2; exit 1; }
grep -q '^SENTRY_UPLOAD=failed' "$LOG" && echo "build-ios: WARNING Sentry upload failed (build kept), see $LOG" >&2

NAME=mento-$ENV_NAME-$VERSION-$BUILD_NUMBER-$SHA.ipa
rsync -a -e "ssh ${SSH_OPTS[*]}" "$TARGET:$REMOTE_DIR/build/ipa/*.ipa" "$STAGE/"
IPA=$(ls "$STAGE"/*.ipa | head -1)
cp "$IPA" "$OUTDIR/$NAME"
(cd "$OUTDIR" && sha256sum "$NAME" >"$NAME.sha256")
echo "$OUTDIR/$NAME" >"$OUTDIR/last-ios.path"
echo "build-ios: built $OUTDIR/$NAME"
echo "build-ios: upload to App Store Connect / TestFlight is the founder's step (docs/BUILDS.md)"
