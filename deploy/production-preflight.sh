#!/usr/bin/env bash
# Read-only checks on VPS A. A pass is necessary, not sufficient, for promotion.
# Run with operator access; never prints environment values or private keys.
set -uo pipefail
failures=0
check() {
  local label=$1
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label"
    failures=$((failures + 1))
  fi
}
worker_running() {
  test "$(docker inspect --format '{{.State.Running}}' mento-worker-prod 2>/dev/null)" = true
}
disk_headroom() {
  test "$(df -Pk /opt/mento | awk 'NR==2 {print $4}')" -ge 8388608
}
check 'Production API readiness' curl --fail --silent --max-time 10 http://127.0.0.1:8000/api/v1/health/ready
check 'Recent production safety webhook (freshness only)' curl --fail --silent --max-time 10 http://127.0.0.1:8000/api/v1/health/crisis
check 'Worker container running (not end-to-end job proof)' worker_running
check 'Production web uses release symlink' test -L /opt/mento-console/current
check 'Recorded previous API image tag' test -s /home/mento-ops/.local/state/mento/api-tag.previous
check 'Installed deploy script includes worker startup' grep -Fq 'start_worker "$TAG"' /opt/mento/deploy/deploy.sh
check 'At least 8 GiB free for release/rollback artifacts' disk_headroom
printf 'Remaining manual gates: reviewed receiver and deploy script, artifact identity, job execution/health, rollback drill, encrypted deletion-compatible backups, restore proof, delivered alerts, privacy/security and device acceptance.\n'
if [ "$failures" -gt 0 ]; then
  printf 'BLOCKED: %s preflight checks failed; do not enable promotion.\n' "$failures"
  exit 1
fi
printf 'Automated preflight passed; manual release gates still apply.\n'
