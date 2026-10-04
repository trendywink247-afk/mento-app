#!/usr/bin/env bash
# Fully simulated curl: no external probes or notification delivery.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir "$temp/bin"
export STATE_DIR="$temp/state" NTFY_TOPIC=synthetic-topic
export ALERT_LOG="$temp/alerts" ALERT_FAIL=1 PROBE_CODE=500
export CRISIS_FAIL=0
cat > "$temp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
if [[ " $* " == *' -d '* ]]; then
  echo attempt >> "$ALERT_LOG"
  exit "$ALERT_FAIL"
fi
if [[ " $* " == *'/health/crisis '* ]]; then
  if [ "$CRISIS_FAIL" = 1 ]; then exit 7; fi
  printf '{"status":"ok"}\n200'
  exit 0
fi
printf '%s' "$PROBE_CODE"
MOCK
chmod +x "$temp/bin/curl"
export PATH="$temp/bin:$PATH"
if NTFY_TOPIC=__NTFY_TOPIC__ bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: unconfigured notification destination accepted'; exit 1
fi
test ! -e "$ALERT_LOG"
test ! -e "$STATE_DIR"
export MONITOR_CHECK_ONLY=1
if bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: probe-only mode accepted unhealthy endpoint'; exit 1
fi
test ! -e "$ALERT_LOG"
test ! -e "$STATE_DIR"
export PROBE_CODE=200
bash "$root/deploy/external-monitor.sh"
export CRISIS_FAIL=1
if bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: probe-only mode accepted crisis transport failure'; exit 1
fi
test ! -e "$ALERT_LOG"
test ! -e "$STATE_DIR"
export MONITOR_CHECK_ONLY=0 PROBE_CODE=500 CRISIS_FAIL=0
if bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: failed delivery reported success'; exit 1
fi
test ! -e "$STATE_DIR/api-health"
export ALERT_FAIL=0
bash "$root/deploy/external-monitor.sh"
test "$(cat "$STATE_DIR/api-health")" = down
count=$(wc -l < "$ALERT_LOG")
bash "$root/deploy/external-monitor.sh"
test "$(wc -l < "$ALERT_LOG")" = "$count"
export PROBE_CODE=200 ALERT_FAIL=1
if bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: failed recovery delivery reported success'; exit 1
fi
test "$(cat "$STATE_DIR/api-health")" = down
export ALERT_FAIL=0
bash "$root/deploy/external-monitor.sh"
test "$(cat "$STATE_DIR/api-health")" = up
export CRISIS_FAIL=1 ALERT_FAIL=1
if bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: failed crisis alert reported success'; exit 1
fi
test "$(cat "$STATE_DIR/api-crisis-reachable")" = up
export ALERT_FAIL=0
bash "$root/deploy/external-monitor.sh"
test "$(cat "$STATE_DIR/api-crisis-reachable")" = down
count=$(wc -l < "$ALERT_LOG")
bash "$root/deploy/external-monitor.sh"
test "$(wc -l < "$ALERT_LOG")" = "$count"
export CRISIS_FAIL=0 ALERT_FAIL=1
if bash "$root/deploy/external-monitor.sh"; then
  echo 'FAIL: failed crisis recovery reported success'; exit 1
fi
test "$(cat "$STATE_DIR/api-crisis-reachable")" = down
export ALERT_FAIL=0
bash "$root/deploy/external-monitor.sh"
test "$(cat "$STATE_DIR/api-crisis-reachable")" = up
before=$(find "$STATE_DIR" -type f -exec sha256sum {} \; | sort)
count=$(wc -l < "$ALERT_LOG")
MONITOR_CHECK_ONLY=1 bash "$root/deploy/external-monitor.sh"
test "$(find "$STATE_DIR" -type f -exec sha256sum {} \; | sort)" = "$before"
test "$(wc -l < "$ALERT_LOG")" = "$count"
echo 'PASS: failed outage/recovery alerts retry; delivered states deduplicate'
echo 'PASS: probe-only checks report failures without alerts or state changes'
