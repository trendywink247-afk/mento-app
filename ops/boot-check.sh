#!/usr/bin/env bash
# Run the API's startup safety checks against an environment file, offline, inside a
# release-candidate image built from a git ref. Prints ONLY the names of failing settings.
# Run as root (it builds an image and reads a root-only env file).
#
#   ops/boot-check.sh [--image <tag>] <git ref or sha> <env file>
#
# QA, before QA gets the new image:
#
#   /srv/mento/wt-prod/ops/boot-check.sh feat/ops-prod /opt/mento-staging/secrets/api.env
#
# What it does:
#   1. resolves <ref> to a commit (git runs as `agent`, the repo owner; BUILD_GIT_USER=
#      empty = run git directly, for a root-owned clone);
#   2. builds mento-api:<shortsha>-r<N> from that commit with ops/build-api.sh (a fresh
#      tag, never reusing one), or with --image checks that an existing image's recorded
#      commit is exactly that commit;
#   3. runs  docker run --rm --network none --env-file <env file> <image> python -m app.boot_check
#      The container has no network, is removed afterwards, starts no server, touches no
#      database and no compose project. Nothing running is changed.
#
# Output contract:
#   stdout  the names of failing settings, one per line, and nothing else (empty = all
#           checks passed). Never a value.
#   stderr  progress and the verdict (PASS/FAIL), never a value.
#   exit    0 all checks passed; 1 at least one failed; 2 usage/setup error; 3 build failed.
#
# Notes: `docker run --env-file` takes lines literally (no quote stripping). If the file
# has quoted values the check can fail on them even though compose would accept them;
# the failing name tells you which setting to look at. The file's values do enter the
# throwaway container's environment, as they do for the real api container.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
GIT_USER="${BUILD_GIT_USER-agent}"

die() { echo "boot-check: $*" >&2; exit 2; }
note() { echo "boot-check: $*" >&2; }
as_repo_owner() { if [ -n "$GIT_USER" ]; then sudo -u "$GIT_USER" "$@"; else "$@"; fi; }

IMAGE_TAG=""
if [ "${1:-}" = "--image" ]; then
    [ $# -ge 2 ] || die "usage: ops/boot-check.sh [--image <tag>] <git ref or sha> <env file>"
    IMAGE_TAG="${2#mento-api:}"
    shift 2
fi
[ $# -eq 2 ] || die "usage: ops/boot-check.sh [--image <tag>] <git ref or sha> <env file>"
REF=$1
ENV_FILE=$2

[ "$(id -u)" -eq 0 ] || die "must run as root"
[ -f "$ENV_FILE" ] || die "no such env file: $ENV_FILE"
SHA="$(as_repo_owner git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}")" || die "unknown git ref: $REF"

if [ -n "$IMAGE_TAG" ]; then
    LABEL="$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "mento-api:$IMAGE_TAG" 2>/dev/null)" \
        || die "image mento-api:$IMAGE_TAG not found"
    [ "$LABEL" = "$SHA" ] || die "mento-api:$IMAGE_TAG was built from ${LABEL:-an unknown commit}, not from $REF ($SHA)"
else
    BUILD_LOG="$(mktemp)"
    trap 'rm -f "$BUILD_LOG"' EXIT
    note "building a release-candidate image from $REF ($SHA); build log: $BUILD_LOG"
    if ! as_repo_owner env BUILD_GIT_USER="$GIT_USER" "$HERE/build-api.sh" "$SHA" | bash > "$BUILD_LOG" 2>&1; then
        trap - EXIT
        note "image build FAILED; see $BUILD_LOG"
        exit 3
    fi
    IMAGE_TAG="$(sed -n 's/^built mento-api:\([^;]*\);.*/\1/p' "$BUILD_LOG" | tail -n 1)"
    [ -n "$IMAGE_TAG" ] || { trap - EXIT; note "could not read the built tag from $BUILD_LOG"; exit 3; }
fi
note "image mento-api:$IMAGE_TAG, commit $SHA, env file $ENV_FILE"

set +e
docker run --rm --network none --env-file "$ENV_FILE" "mento-api:$IMAGE_TAG" python -m app.boot_check
RC=$?
set -e

case "$RC" in
    0) note "PASS: every startup check passed" ;;
    1) note "FAIL: fix the setting name(s) printed above (stdout), then re-run" ;;
    *) note "the checker itself failed (exit $RC); no verdict" ;;
esac
exit "$RC"
