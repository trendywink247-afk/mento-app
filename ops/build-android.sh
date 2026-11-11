#!/usr/bin/env bash
# ops/build-android.sh <qa|prod> [options] — build a signed Android app from a clean checkout of one
# commit, on this box, with no cloud build service. docs/BUILDS.md has the whole story.
#
#   --sha <commit>        commit to build (default HEAD of this repo)
#   --aab                 Play bundle (bundleRelease) instead of an APK (assembleRelease)
#   --build-dir <dir>     git checkout to build in (default ~/build/<env>; created as a worktree)
#   --out-dir <dir>       where the artifact lands (default ~/build-out/<env>)
#   --version-code <n>    set android.versionCode in the build checkout only (repo untouched)
#   --web-export          also export the web app to apps/mobile/dist-qa in the build checkout
#   --log <file>          build log (default <out-dir>/build-<sha>.log)
#
# QA is signed the way QA builds always were (the generated project's own key; the QA package
# installs beside the store app). Prod is signed only with the Play upload key from
# .secrets/play-upload.jks + .secrets/play-upload.env, and refuses to build without it.
# Sentry sourcemaps and native symbols are uploaded only when SENTRY_AUTH_TOKEN is set
# (.secrets/<env>.env); a failed upload warns and never fails the build. Nothing secret is echoed.
set -euo pipefail

usage() { sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

ENV_NAME=${1:-}
case $ENV_NAME in qa | prod) shift ;; *) usage ;; esac

REPO=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=ops/lib/build-env.sh
. "$REPO/ops/lib/build-env.sh"

REF=HEAD AAB=0 BUILD= OUTDIR= VCODE= WEB=0 LOG=
while [ $# -gt 0 ]; do
  case $1 in
    --sha) REF=${2:?--sha needs a commit}; shift 2 ;;
    --aab) AAB=1; shift ;;
    --build-dir) BUILD=${2:?}; shift 2 ;;
    --out-dir) OUTDIR=${2:?}; shift 2 ;;
    --version-code) VCODE=${2:?}; shift 2 ;;
    --web-export) WEB=1; shift ;;
    --log) LOG=${2:?}; shift 2 ;;
    *) usage ;;
  esac
done
[ -z "$VCODE" ] || [[ $VCODE =~ ^[0-9]+$ ]] || { echo "build-android: --version-code must be a number" >&2; exit 2; }

FULL=$(git -C "$REPO" rev-parse --verify "$REF^{commit}")
SHA=${FULL:0:7}
BUILD=${BUILD:-$HOME/build/$ENV_NAME}
OUTDIR=${OUTDIR:-$HOME/build-out/$ENV_NAME}
LOG=${LOG:-$OUTDIR/build-$SHA.log}
mkdir -p "$OUTDIR" "$(dirname "$LOG")"

# Prod signing material must exist before anything runs (never half-build a store artifact).
if [ "$ENV_NAME" = prod ]; then
  KEYSTORE=$MENTO_SECRETS/play-upload.jks
  [ -r "$KEYSTORE" ] || { echo "build-android: prod needs the Play upload key at $KEYSTORE (docs/PLAY_RELEASE.md)" >&2; exit 3; }
  MENTO_UPLOAD_STORE_PASSWORD= MENTO_UPLOAD_KEY_ALIAS= MENTO_UPLOAD_KEY_PASSWORD=
  mento_load_secrets "$MENTO_SECRETS/play-upload.env" \
    MENTO_UPLOAD_STORE_PASSWORD MENTO_UPLOAD_KEY_ALIAS MENTO_UPLOAD_KEY_PASSWORD
  for k in MENTO_UPLOAD_STORE_PASSWORD MENTO_UPLOAD_KEY_ALIAS MENTO_UPLOAD_KEY_PASSWORD; do
    [ -n "${!k}" ] || { echo "build-android: $k missing from $MENTO_SECRETS/play-upload.env" >&2; exit 3; }
  done
  export MENTO_UPLOAD_KEYSTORE=$KEYSTORE
fi

# One build per checkout at a time.
mkdir -p "$(dirname "$BUILD")"
exec 8>"${BUILD%/}.lock"
flock -n 8 || { echo "build-android: a build is already running in $BUILD" >&2; exit 4; }

if [ ! -e "$BUILD/.git" ]; then
  [ ! -e "$BUILD" ] || { echo "build-android: $BUILD exists and is not a git checkout" >&2; exit 2; }
  git -C "$REPO" worktree add -q --detach "$BUILD" "$FULL"
fi

mento_android_toolchain
echo "build-android: $ENV_NAME $SHA ($([ "$AAB" = 1 ] && echo aab || echo apk)) (log: $LOG)"
# A subshell with errexit live: `{ ...; } || handler` would silently ignore failing steps.
set +e
(
  set -e
  git -C "$BUILD" fetch -q "$REPO" "$FULL"
  git -C "$BUILD" checkout -q -f --detach "$FULL"
  cd "$BUILD/apps/mobile"
  if [ -n "$VCODE" ]; then
    sed -i "s/\"versionCode\": [0-9]*,/\"versionCode\": $VCODE,/" app.json
  fi
  # The update-signing certificate the app embeds (docs/OTA.md). Prod never ships without one.
  if [ "$ENV_NAME" = prod ] && [ ! -s certs/ota-prod.pem ]; then
    echo "apps/mobile/certs/ota-prod.pem is missing at $SHA: generate it with ops/ota-keygen.sh prod (docs/OTA.md) and commit the certificate"
    exit 3
  fi
  if [ "$ENV_NAME" = qa ] && grep -q 'ota-qa.pem' app.config.ts && [ ! -s certs/ota-qa.pem ]; then
    echo "apps/mobile/certs/ota-qa.pem is missing at $SHA"
    exit 3
  fi
  mento_build_env "$ENV_NAME" "$SHA"
  env -u NODE_ENV npm ci --no-audit --no-fund
  NODE_ENV=production npx expo prebuild --platform android --clean
  if [ "$WEB" = 1 ]; then
    rm -rf dist-qa
    NODE_ENV=production npx expo export --platform web --output-dir dist-qa
    [ -f dist-qa/index.html ] || { echo "web export produced no index.html"; exit 7; }
  fi
  cd android
  TASK=assembleRelease
  [ "$AAB" = 1 ] && TASK=bundleRelease
  ARCHS=()
  # QA phones are arm64; the store build carries every ABI.
  [ "$ENV_NAME" = qa ] && ARCHS=(-PreactNativeArchitectures=arm64-v8a)
  NODE_ENV=production nice -n 10 ./gradlew "$TASK" "${ARCHS[@]}" --no-daemon \
    -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease
) >"$LOG" 2>&1
RC=$?
set -e
[ "$RC" = 0 ] || { echo "build-android: build FAILED, see $LOG" >&2; tail -15 "$LOG" >&2; exit 1; }

APP=$BUILD/apps/mobile
if [ "$AAB" = 1 ]; then
  SRC=$APP/android/app/build/outputs/bundle/release/app-release.aab EXT=aab
else
  SRC=$APP/android/app/build/outputs/apk/release/app-release.apk EXT=apk
fi
[ -s "$SRC" ] || { echo "build-android: no artifact at $SRC" >&2; exit 1; }
VERSION=$(mento_app_json "$APP/app.json" expo.version)
CODE=$(mento_app_json "$APP/app.json" expo.android.versionCode)

# Sentry: release = the short sha the app reports, dist = versionCode. Token present = upload.
sentry_upload() {
  local cli=$APP/node_modules/.bin/sentry-cli gen=$APP/android/app/build
  local bundle=$gen/generated/assets/react/release/index.android.bundle
  local map=$gen/generated/sourcemaps/react/release/index.android.bundle.map
  [ -x "$cli" ] || { echo "sentry-cli not installed"; return 1; }
  [ -s "$bundle" ] && [ -s "$map" ] || { echo "no bundle/sourcemap under $gen/generated"; return 1; }
  "$cli" releases new "$SHA" || return 1
  "$cli" sourcemaps upload --release "$SHA" --dist "$CODE" --strip-prefix "$APP" "$bundle" "$map" || return 1
  if [ -d "$gen/intermediates/merged_native_libs" ]; then
    "$cli" debug-files upload "$gen/intermediates/merged_native_libs" || return 1
  fi
  if [ -f "$gen/outputs/mapping/release/mapping.txt" ]; then
    "$cli" upload-proguard "$gen/outputs/mapping/release/mapping.txt" || return 1
  fi
  "$cli" releases finalize "$SHA"
}
(
  mento_build_env "$ENV_NAME" "$SHA" >/dev/null 2>&1 || true
  if [ -n "${SENTRY_AUTH_TOKEN:-}" ] && [ -n "${SENTRY_ORG:-}" ] && [ -n "${SENTRY_PROJECT:-}" ]; then
    if sentry_upload >>"$LOG" 2>&1; then
      echo "build-android: Sentry sourcemaps and symbols uploaded (release $SHA, dist $CODE)"
    else
      echo "build-android: WARNING Sentry upload failed (build kept), see $LOG" >&2
    fi
  else
    echo "build-android: Sentry upload skipped (no SENTRY_AUTH_TOKEN/ORG/PROJECT in .secrets/$ENV_NAME.env)"
  fi
)

NAME=mento-$ENV_NAME-$VERSION-$CODE-$SHA.$EXT
cp "$SRC" "$OUTDIR/$NAME"
(cd "$OUTDIR" && sha256sum "$NAME" >"$NAME.sha256")
echo "$OUTDIR/$NAME" >"$OUTDIR/last.path"
SUM=$(cut -d' ' -f1 "$OUTDIR/$NAME.sha256")
echo "build-android: built $OUTDIR/$NAME ($VERSION build $CODE, sha256 ${SUM:0:12}…)"
if [ "$ENV_NAME" = prod ]; then
  echo "build-android: upload to Play Console is the founder's step (docs/PLAY_RELEASE.md)"
fi
