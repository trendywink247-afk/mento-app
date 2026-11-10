#!/usr/bin/env bash
# ops/qa-apk.sh [<commit>] — build the Mento QA APK from <commit> (default HEAD) and stage it as a
# QA web release: the live web folder with downloads/mento-qa.apk and the download page replaced.
# Needs no root. The last step is root's: `sudo qa-install-web <tarball>` (printed at the end), or
# `sudo /usr/local/sbin/qa-agent/apk-publish.sh` once infra/qa-agent/apk-publish.sh is installed.
#
# Why a whole web release: qa-install-web swaps the entire /opt/mento-staging/web folder, so the new
# tarball must carry the QA web app too; it is copied from whatever is live right now.
# Secrets: the build reads one EXPO_PUBLIC_* value (the Stream public key) from $QA_APK_ENV; nothing is
# echoed. EXPO_PUBLIC_* values ship inside the app by design.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
FULL=$(git -C "$REPO" rev-parse "${1:-HEAD}")
SHA=${FULL:0:7}
BUILD=${QA_APK_BUILD_DIR:-$HOME/aabbuild}
OUT=${QA_APK_OUT:-$HOME/qa-apk-out}
ENVF=${QA_APK_ENV:-$HOME/.config/mento/qa-build.env}
LIVE=${QA_WEB_LIVE:-/opt/mento-staging/web}
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
  env -u NODE_ENV npm ci --no-audit --no-fund
  NODE_ENV=production npx expo prebuild --platform android --clean
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

# The release is the live web folder with the APK and the page replaced.
REL=web-$SHA-qa-apk$CODE
STAGE=$OUT/$REL
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -rL "$LIVE"/. "$STAGE"/
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
