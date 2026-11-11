#!/usr/bin/env bash
# ops/qa-apk.sh [<commit>] — build the Mento QA APK from <commit> (default HEAD) and stage it as a
# QA web release: the live web folder with downloads/mento-qa.apk and the download page replaced.
# Needs no root. The last step is root's: `sudo qa-install-web <tarball>` (printed at the end), or
# `sudo /usr/local/sbin/qa-agent/apk-publish.sh` once infra/qa-agent/apk-publish.sh is installed.
#
# Why a whole web release: qa-install-web swaps the entire /opt/mento-staging/web folder, so the new
# tarball carries the QA web app (member app + admin console, exported from the same commit) as well as
# downloads/. Building both together keeps the web admin from falling behind the API and the APK.
# Secrets: the build reads one EXPO_PUBLIC_* value (the Stream public key) from $QA_APK_ENV; nothing is
# echoed. EXPO_PUBLIC_* values ship inside the app by design.
# Sentry (optional): $MENTO_SECRETS_DIR/qa.env (default /srv/mento/mento-app/.secrets/qa.env, kept out of the
# repo) may hold EXPO_PUBLIC_SENTRY_DSN (the app's QA DSN) and, for sourcemap upload, SENTRY_AUTH_TOKEN,
# SENTRY_ORG, SENTRY_PROJECT. File or keys missing = Sentry off / no upload; the build never fails for it.
# See docs/SENTRY.md.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
FULL=$(git -C "$REPO" rev-parse "${1:-HEAD}")
SHA=${FULL:0:7}
BUILD=${QA_APK_BUILD_DIR:-$HOME/aabbuild}
OUT=${QA_APK_OUT:-$HOME/qa-apk-out}
ENVF=${QA_APK_ENV:-$HOME/.config/mento/qa-build.env}
SECRETS_QA=${MENTO_SECRETS_DIR:-/srv/mento/mento-app/.secrets}/qa.env
LOG=$OUT/build-$SHA.log

[ -r "$ENVF" ] || { echo "qa-apk: missing $ENVF (one line: EXPO_PUBLIC_STREAM_API_KEY=...)" >&2; exit 2; }
[ -e "$BUILD/.git" ] || { echo "qa-apk: $BUILD is not a git checkout" >&2; exit 2; }
mkdir -p "$OUT"
exec 9>"$OUT/.lock"
flock -n 9 || { echo "qa-apk: a build is already running" >&2; exit 4; }

export JAVA_HOME=${JAVA_HOME:-$HOME/toolchain/jdk17} ANDROID_HOME=${ANDROID_HOME:-$HOME/toolchain/android}
export PATH=$JAVA_HOME/bin:$PATH TMPDIR=$HOME/tmpbuild
export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$TMPDIR"
mkdir -p "$TMPDIR"

echo "qa-apk: building $SHA (log: $LOG)"
{
  git -C "$BUILD" fetch -q "$REPO" "$FULL"
  git -C "$BUILD" checkout -q -f --detach "$FULL"
  cd "$BUILD/apps/mobile"
  export EXPO_NO_DOTENV=1 APP_VARIANT=preview EXPO_PUBLIC_APP_ENV=qa EXPO_PUBLIC_API_URL=https://qa-api.mento.chat/api/v1 \
    EXPO_PUBLIC_PUSH_DIRECT=1 EXPO_PUBLIC_OWN_CHAT_ACCEPTED=1 EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED=1 \
    EXPO_PUBLIC_GIT_SHA=$SHA SENTRY_DISABLE_AUTO_UPLOAD=true CI=1
  EXPO_PUBLIC_STREAM_API_KEY=$(grep '^EXPO_PUBLIC_STREAM_API_KEY=' "$ENVF" | cut -d= -f2- | tr -d '"')
  export EXPO_PUBLIC_STREAM_API_KEY
  [ -n "$EXPO_PUBLIC_STREAM_API_KEY" ] || { echo "no stream key in $ENVF"; exit 8; }
  # Sentry for the QA app (all optional, read by name; values are never echoed).
  sv() { { [ -r "$SECRETS_QA" ] && grep -m1 "^$1=" "$SECRETS_QA" | cut -d= -f2- | tr -d '"'; } || true; }
  DSN=$(sv EXPO_PUBLIC_SENTRY_DSN)
  if [ -n "$DSN" ]; then export EXPO_PUBLIC_SENTRY_DSN=$DSN; else echo "qa-apk: no QA Sentry DSN, Sentry stays off in this build"; fi
  TOKEN=$(sv SENTRY_AUTH_TOKEN)
  if [ -n "$TOKEN" ]; then
    export SENTRY_AUTH_TOKEN=$TOKEN SENTRY_ORG=$(sv SENTRY_ORG) SENTRY_PROJECT=$(sv SENTRY_PROJECT) SENTRY_ALLOW_FAILURE=true
    unset SENTRY_DISABLE_AUTO_UPLOAD
    echo "qa-apk: Sentry sourcemap upload enabled"
  fi
  env -u NODE_ENV npm ci --no-audit --no-fund
  NODE_ENV=production npx expo prebuild --platform android --clean
  rm -rf dist-qa
  NODE_ENV=production npx expo export --platform web --output-dir dist-qa
  [ -f dist-qa/index.html ] || { echo "web export produced no index.html"; exit 7; }
  cd android
  NODE_ENV=production nice -n 10 ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --no-daemon \
    -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease
} >"$LOG" 2>&1 || { echo "qa-apk: build FAILED, see $LOG" >&2; tail -15 "$LOG" >&2; exit 1; }

APK=$BUILD/apps/mobile/android/app/build/outputs/apk/release/app-release.apk
[ -s "$APK" ] || { echo "qa-apk: no APK at $APK" >&2; exit 1; }
VERSION=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["expo"]["version"])' "$BUILD/apps/mobile/app.json")
CODE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["expo"]["android"]["versionCode"])' "$BUILD/apps/mobile/app.json")
SUM=$(sha256sum "$APK" | cut -d' ' -f1)
MB=$(( ($(stat -c%s "$APK") + 1048575) / 1048576 ))

# The release is the fresh web export plus downloads/ (the APK and its page).
REL=web-$SHA-qa-apk$CODE
STAGE=$OUT/$REL
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -r "$BUILD/apps/mobile/dist-qa"/. "$STAGE"/
mkdir -p "$STAGE/downloads"
cp "$APK" "$STAGE/downloads/mento-qa.apk"
sed "s/@SIZE@/$MB/; s/@VERSION@/$VERSION/; s/@BUILD@/$CODE/; s/@SHA256@/$SUM/; s/@COMMIT@/$SHA/" \
  "$REPO/infra/qa-downloads/index.html.tmpl" >"$STAGE/downloads/index.html"
TAR=$OUT/$REL.tar.gz
tar -czf "$TAR" -C "$STAGE" .
(cd "$OUT" && sha256sum "$REL.tar.gz" >"$REL.tar.gz.sha256")
rm -rf "$STAGE"
ln -sfn "$TAR" "$OUT/latest.tar.gz"
echo "$TAR" >"$OUT/latest.path"
echo "qa-apk: staged $TAR (APK $VERSION build $CODE, $MB MB, sha256 ${SUM:0:12}…)"
echo "qa-apk: publish with:  sudo /usr/local/sbin/qa-install-web $TAR"
