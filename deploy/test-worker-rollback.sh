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
