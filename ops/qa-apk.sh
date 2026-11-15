#!/usr/bin/env bash
# ops/qa-apk.sh [<commit>] — build the Mento QA APK from <commit> (default HEAD) and stage it as a
# QA web release: the live web folder with downloads/mento-qa.apk and the download page replaced.
# Needs no root. The last step is root's: `sudo qa-install-web <tarball>` (printed at the end), or
# `sudo /usr/local/sbin/qa-agent/apk-publish.sh` once infra/qa-agent/apk-publish.sh is installed.
#
# Why a whole web release: qa-install-web swaps the entire /opt/mento-staging/web folder, so the new
# tarball carries the QA web app (member app + admin console, exported from the same commit) as well as
# downloads/. Building both together keeps the web admin from falling behind the API and the APK.
#
# The build itself is ops/build-android.sh qa (shared with prod and with manual builds); this script
# adds the web export and turns the result into a QA web release. The poller (ops/qa-apk-poll.sh) sets
# QA_APK_BUMP_TO so the next versionCode is applied in the build checkout only.
# Secrets: EXPO_PUBLIC_* values (the Stream public key, the QA Sentry DSN) come from .secrets/qa.env
# or, for the Stream key, $QA_APK_ENV (ops/lib/build-env.sh); nothing is echoed. EXPO_PUBLIC_* values
# ship inside the app by design.
set -euo pipefail

REPO=$(cd "$(dirname "$0")/.." && pwd)
# shellcheck source=ops/lib/build-env.sh
. "$REPO/ops/lib/build-env.sh"
FULL=$(git -C "$REPO" rev-parse "${1:-HEAD}")
SHA=${FULL:0:7}
BUILD=${QA_APK_BUILD_DIR:-$HOME/aabbuild}
OUT=${QA_APK_OUT:-$HOME/qa-apk-out}
ENVF=${QA_APK_ENV:-$HOME/.config/mento/qa-build.env}
LOG=$OUT/build-$SHA.log

[ -e "$BUILD/.git" ] || { echo "qa-apk: $BUILD is not a git checkout" >&2; exit 2; }
mkdir -p "$OUT"
exec 9>"$OUT/.lock"
flock -n 9 || { echo "qa-apk: a build is already running" >&2; exit 4; }

echo "qa-apk: building $SHA (log: $LOG)"
BUMP=()
[ -z "${QA_APK_BUMP_TO:-}" ] || BUMP=(--version-code "$QA_APK_BUMP_TO")
QA_APK_ENV=$ENVF "$REPO/ops/build-android.sh" qa --sha "$FULL" --build-dir "$BUILD" --web-export \
  --log "$LOG" "${BUMP[@]}" >/dev/null \
  || { echo "qa-apk: build FAILED, see $LOG" >&2; tail -15 "$LOG" >&2; exit 1; }

APK=$BUILD/apps/mobile/android/app/build/outputs/apk/release/app-release.apk
[ -s "$APK" ] || { echo "qa-apk: no APK at $APK" >&2; exit 1; }
VERSION=$(mento_app_json "$BUILD/apps/mobile/app.json" expo.version)
CODE=$(mento_app_json "$BUILD/apps/mobile/app.json" expo.android.versionCode)
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
