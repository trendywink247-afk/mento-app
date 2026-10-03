#!/usr/bin/env bash
# Exercise real deployment control flow with no Docker, network or serving data.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
source <(sed '/^main "\$@"; exit$/d' "$root/deploy/deploy.sh")
dc() { return 1; }
if start_worker candidate; then
  echo 'FAIL: failed Compose startup must return failure'; exit 1
fi
for scenario in success failed missing same; do
  code=0
  output=$(
    start_worker() { echo "worker:$1"; test "$scenario" = success; }
    rollback() { echo "rollback:$1"; }
    previous=previous
    [ "$scenario" != missing ] || previous=''
    [ "$scenario" != same ] || previous=candidate
    activate_worker_or_rollback candidate "$previous" legacy
  ) || code=$?
  case "$scenario" in
    success) test "$code" = 0; [[ "$output" != *rollback:* ]] ;;
    failed) test "$code" != 0; [[ "$output" == *rollback:legacy* ]] ;;
    missing|same) test "$code" != 0; [[ "$output" != *rollback:* ]] ;;
  esac
done
echo 'PASS: worker success, startup failure rollback, missing/same-target refusal'

# Check recovery of an API-only baseline without launching an old image's worker.
STATE_DIR=$(mktemp -d)
trap 'rm -rf "$STATE_DIR"' EXIT
dc() { if [ "$1" = ps ]; then printf '%s' "${worker_id:-}"; else echo "compose:$*"; fi; }
docker() { echo "$worker_running"; }
start_worker() { echo "start:$1"; }
for scenario in absent stopped running; do
    worker_id=worker; worker_running=false
    [ "$scenario" != absent ] || worker_id=''
    [ "$scenario" != running ] || worker_running=true
    record_worker_state "$scenario"
    output=$(restore_worker_state "$scenario")
    case "$scenario" in
        absent|stopped) test "$output" = 'compose:stop worker' ;;
        running) test "$output" = 'start:running' ;;
    esac
done
test "$(restore_worker_state unknown)" = 'start:unknown'
printf 'invalid\n' > "$STATE_DIR/worker-state/bad"
if restore_worker_state bad; then echo 'FAIL: invalid worker metadata accepted'; exit 1; fi
echo 'PASS: absent/stopped/running worker baseline recovery and legacy-state fallback'
