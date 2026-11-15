#!/usr/bin/env bash
# Release drills that start real containers (replaces the former rollback-rehearsal.yml and the
# container parts of test-ci.yml). Everything runs in throwaway containers built from this
# checkout; nothing touches QA, production or the shared test database.
#
#   ops/release-drills.sh [--ci] [--rehearsal legacy|balanced|all]
#
#   default        all container drills below
#   --ci           the quick container drills only (what ops/ci.sh runs when Docker works)
#   --rehearsal S  also the full deploy + rollback rehearsal (deploy/test-deploy.sh S), ~10-30 min
#
# Needs the Docker daemon. When the current user cannot reach it, the script prints the exact
# command for a docker-capable user (or root) and exits 3, so a caller can record a skip.
# Transcript: /srv/mento/logs/drills/<date>-<sha12>.log.
set -uo pipefail

MODE=all
STACK=""
while [ $# -gt 0 ]; do
    case "$1" in
        --ci) MODE=ci; shift ;;
        --rehearsal) STACK=${2:-}; shift 2 ;;
        *) echo "usage: ops/release-drills.sh [--ci] [--rehearsal legacy|balanced|all]" >&2; exit 2 ;;
    esac
done
case "$STACK" in ""|legacy|balanced|all) ;; *) echo "stack must be legacy, balanced or all" >&2; exit 2 ;; esac

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
cd "$REPO" || exit 2
# shellcheck source=ops/lib/ci-tools.sh
. ops/lib/ci-tools.sh

if ! docker_usable; then
    cat >&2 <<EOF
release-drills: the Docker daemon is not reachable as $(id -un).
Run as a docker-capable user (or root) from $REPO:
    bash ops/release-drills.sh${STACK:+ --rehearsal $STACK}
EOF
    exit 3
fi

SHA="$(git rev-parse HEAD)"
LOG_DIR=/srv/mento/logs/drills
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/$(date -u +%F)-${SHA:0:12}.log"
# test-deploy.sh commits in a scratch repo; give it an identity without touching anyone's global git config.
GIT_CONFIG_GLOBAL="$(mktemp)"
export GIT_CONFIG_GLOBAL
git config --global user.name 'Mento rollback rehearsal'
git config --global user.email 'rollback-test@mento.invalid'
trap 'rm -f "$GIT_CONFIG_GLOBAL"' EXIT

FAILED=0
drill() {
    local name=$1 t0 rc
    shift
    t0=$(date +%s)
    echo "=== $name" | tee -a "$LOG"
    "$@" >>"$LOG" 2>&1
    rc=$?
    printf '%s %4ss  %s\n' "$([ "$rc" -eq 0 ] && echo PASS || echo FAIL)" "$(( $(date +%s) - t0 ))" "$name" | tee -a "$LOG"
    [ "$rc" -eq 0 ] || FAILED=1
}

drill "snapshot locks vs partition DDL" bash deploy/test-snapshot-ddl.sh
drill "erasure receipt export" bash deploy/test-erasure-receipt-export.sh
if [ "$MODE" = all ]; then
    drill "build backup-drill image" docker build -q -t mento-backup-drill services/api
    drill "encrypted restore (head)" env RESTORE_IMAGE=mento-backup-drill bash deploy/test-encrypted-database-restore.sh
    drill "encrypted restore (baseline c13a0seen001)" \
        env BASELINE_REVISION=c13a0seen001 RESTORE_IMAGE=mento-backup-drill bash deploy/test-encrypted-database-restore.sh
    drill "build receipt-drill image" docker build -q -t mento-receipt-drill services/recovery_receiver
    drill "recovery receiver container" python3 deploy/test-recovery-receiver-container.py mento-receipt-drill
    drill "build installer test image" docker build -q -f deploy/production-installer-test.Dockerfile -t mento-installer-test deploy
    drill "production installer over SSH" docker run --rm --network none \
        --mount "type=bind,source=$REPO,target=/work,readonly" mento-installer-test /work/deploy/test-production-installer.sh
fi
if [ -n "$STACK" ]; then
    drill "deploy + rollback rehearsal ($STACK)" bash deploy/test-deploy.sh "$STACK"
fi
echo "transcript: $LOG"
exit "$FAILED"
