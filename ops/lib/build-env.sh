# shellcheck shell=bash
# ops/lib/build-env.sh — sourced by ops/build-android.sh, ops/build-ios.sh and ops/qa-apk.sh.
# One place for the per-environment app build settings, so QA and prod cannot drift.
#
#   mento_build_env <qa|prod> <short-sha>   export the public EXPO_PUBLIC_* settings + APP_VARIANT
#   mento_load_secrets <file> <KEY>...      export only the listed keys from a KEY=VALUE file
#   mento_android_toolchain                 JAVA_HOME / ANDROID_HOME / TMPDIR for Gradle
#
# Secrets are read with a parser, never `source`d, and never echoed. Do not turn on `set -x`
# in any script that sources this file.

MENTO_REPO=${MENTO_REPO:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}
# Founder-shared keys live here (git-ignored; rules in docs/SECRETS.md).
MENTO_SECRETS=${MENTO_SECRETS:-/srv/mento/mento-app/.secrets}

# KEY=VALUE lines only; quotes stripped; unknown keys ignored; a missing file is not an error.
mento_load_secrets() {
  local file=$1 line key value want
  shift
  [ -r "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in '' | '#'*) continue ;; esac
    line=${line#export }
    key=${line%%=*}
    value=${line#*=}
    value=${value%\"}; value=${value#\"}; value=${value%\'}; value=${value#\'}
    for want in "$@"; do
      if [ "$key" = "$want" ]; then
        printf -v "$key" '%s' "$value"
        export "${key?}"
      fi
    done
  done <"$file"
}

# The settings every build of an environment gets. EXPO_PUBLIC_* values ship inside the app,
# so nothing here may be a secret.
mento_build_env() {
  local env=$1 sha=$2
  case $env in
    qa)
      export APP_VARIANT=preview EXPO_PUBLIC_APP_ENV=qa
      export EXPO_PUBLIC_API_URL=https://qa-api.mento.chat/api/v1
      ;;
    prod)
      export APP_VARIANT=production EXPO_PUBLIC_APP_ENV=production
      export EXPO_PUBLIC_API_URL=https://api.mento.chat/api/v1
      ;;
    *)
      echo "build-env: environment must be qa or prod, not '$env'" >&2
      return 2
      ;;
  esac
  export EXPO_NO_DOTENV=1 CI=1
  export EXPO_PUBLIC_PUSH_DIRECT=1 EXPO_PUBLIC_OWN_CHAT_ACCEPTED=1 EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED=1
  export EXPO_PUBLIC_GIT_SHA=$sha
  # The Sentry Gradle/Xcode hooks never upload on their own; the build scripts upload with
  # sentry-cli afterwards, and only when a token is present.
  export SENTRY_DISABLE_AUTO_UPLOAD=true

  # Optional per-environment keys (.secrets/<env>.env). Missing file = Sentry off, still builds.
  mento_load_secrets "$MENTO_SECRETS/$env.env" \
    EXPO_PUBLIC_STREAM_API_KEY EXPO_PUBLIC_SENTRY_DSN SENTRY_AUTH_TOKEN SENTRY_ORG SENTRY_PROJECT SENTRY_URL
  # QA's Stream key has lived in this file since the first QA builds; it still works.
  if [ "$env" = qa ] && [ -z "${EXPO_PUBLIC_STREAM_API_KEY:-}" ]; then
    mento_load_secrets "${QA_APK_ENV:-$HOME/.config/mento/qa-build.env}" EXPO_PUBLIC_STREAM_API_KEY
  fi
  if [ -z "${EXPO_PUBLIC_STREAM_API_KEY:-}" ]; then
    echo "build-env: no EXPO_PUBLIC_STREAM_API_KEY for $env (put it in $MENTO_SECRETS/$env.env)" >&2
    return 8
  fi
}

mento_android_toolchain() {
  export JAVA_HOME=${JAVA_HOME:-$HOME/toolchain/jdk17} ANDROID_HOME=${ANDROID_HOME:-$HOME/toolchain/android}
  export PATH=$JAVA_HOME/bin:$PATH TMPDIR=${MENTO_BUILD_TMP:-$HOME/tmpbuild}
  export JAVA_TOOL_OPTIONS="-Djava.io.tmpdir=$TMPDIR"
  mkdir -p "$TMPDIR"
}

# app.json field, e.g. mento_app_json expo.version
mento_app_json() {
  python3 -c 'import json,sys
d=json.load(open(sys.argv[1]))
for k in sys.argv[2].split("."): d=d[k]
print(d)' "$1" "$2"
}
