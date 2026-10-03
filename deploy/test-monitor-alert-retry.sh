#!/usr/bin/env bash
# Fully simulated curl: no external probes or notification delivery.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir "$temp/bin"
export STATE_DIR="$temp/state" NTFY_TOPIC=synthetic-topic
export ALERT_LOG="$temp/alerts" ALERT_FAIL=1 PROBE_CODE=500
cat > "$temp/bin/curl" <<'MOCK'
#!/usr/bin/env bash
if [[ " $* " == *' -d '* ]]; then
  echo attempt >> "$ALERT_LOG"
  exit "$ALERT_FAIL"
fi
printf '%s' "$PROBE_CODE"
MOCK
chmod +x "$temp/bin/curl"
export PATH="$temp/bin:$PATH"
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
echo 'PASS: failed outage/recovery alerts retry; delivered states deduplicate'
