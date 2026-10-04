#!/usr/bin/env bash
# External uptime monitor — runs on VPS B (31.42.125.238), watching the
# prod box (mento.chat) from outside, so it still fires if the whole new box goes
# down (the new box's own /opt/mento-monitor/healthcheck.sh can't catch that —
# it checks itself). No third-party account: alerts go to a private ntfy.sh topic.
#
# Install as a cron job on the OLD box:
#   */5 * * * * /opt/mento-backups/external-monitor.sh >> /opt/mento-backups/external-monitor.log 2>&1
set -u
set -o pipefail
NTFY_TOPIC="${NTFY_TOPIC:-__NTFY_TOPIC__}"
STATE_DIR=${STATE_DIR:-/opt/mento-backups/.monitor-state}
# Explicit probe-only mode for deployment acceptance: no alert delivery and no
# changes to notification deduplication state. Invalid values fail closed.
CHECK_ONLY=${MONITOR_CHECK_ONLY:-0}
case "$CHECK_ONLY" in 0|1) ;; *) echo 'Invalid MONITOR_CHECK_ONLY' >&2; exit 2 ;; esac
if [ "$CHECK_ONLY" = 0 ] && { [ -z "$NTFY_TOPIC" ] || [ "$NTFY_TOPIC" = __NTFY_TOPIC__ ]; }; then
  echo 'Notification topic is not configured; use MONITOR_CHECK_ONLY=1 for probes' >&2
  exit 2
fi
if [ "$CHECK_ONLY" = 0 ]; then mkdir -p "$STATE_DIR"; fi

alert() {
  local msg="$1"
  curl -fsS -m 10 -d "$msg" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1
}

# check NAME URL WANT_CODE — pages only on a state change (down -> alert, then
# silent while still down, then one more alert on recovery), so a flaky network
# blip doesn't spam the phone every 5 minutes.
check() {
  local name="$1" url="$2" want="$3" code state_file="$STATE_DIR/$1"
  # No -f: an HTTP error (4xx/5xx) still returns curl exit 0 with the real code in
  # %{http_code} — only a DNS/connect/timeout failure should read as unreachable.
  code=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 "$url" 2>/dev/null)
  [ $? -eq 0 ] && [ -n "$code" ] || code="ERR"
  if [ "$CHECK_ONLY" = 1 ]; then
    if [ "$code" = "$want" ]; then printf 'PASS %s\n' "$name"; return 0; fi
    printf 'FAIL %s\n' "$name"; return 1
  fi
  local prev="unknown"
  [ -f "$state_file" ] && prev="$(cat "$state_file")"
  if [ "$code" = "$want" ]; then
    if [ "$prev" = "down" ]; then alert "RECOVERED: $name ($url) is back, got $code" || return 1; fi
    echo "up" > "$state_file"
  else
    if [ "$prev" != "down" ]; then alert "DOWN: $name ($url) -> $code (want $want)" || return 1; fi
    echo "down" > "$state_file"
  fi
}

# Keep the previous notified state on delivery failure so the next run retries.
failures=0
check api-health  https://api.mento.chat/api/v1/health        200 || failures=1
check api-ready   https://api.mento.chat/api/v1/health/ready  200 || failures=1
check web-app     https://app.mento.chat/                     200 || failures=1
check web-admin   https://admin.mento.chat/admin               200 || failures=1

# health/crisis legitimately reports 503 "stale" whenever no real crisis-webhook
# message has passed through recently — that is expected, not an outage (see
# PROGRESS.md). Degraded, malformed and unexpected HTTP responses are failures.
# Install the classifier beside this script; missing Python/helper fails closed.
monitor_dir=$(cd "$(dirname "$0")" && pwd)
# Optional trusted executable wrapper (for example, pinned read-only SSH to A).
# No shell evaluation; stdout is bounded, classified, and never logged verbatim.
# Not configured means operational acceptance is still outstanding.
operational_check() {
  if [ -z "${MONITOR_OPERATIONAL_PROBE:-}" ]; then
    [ "$CHECK_ONLY" != 1 ] || echo 'SKIP operational probes (not configured)'
    return 0
  fi
  local ok=0 labels state_file="$STATE_DIR/operational-health" prev="unknown"
  if labels=$(timeout 20 "$MONITOR_OPERATIONAL_PROBE" 2>/dev/null | "${PYTHON:-python3}" "$monitor_dir/classify-operational-health.py" 2>/dev/null); then
    ok=1
  fi
  if [ "$CHECK_ONLY" = 1 ]; then
    if [ -n "$labels" ]; then printf '%s\n' "$labels"; else echo 'FAIL operational probe'; fi
    [ "$ok" = 1 ] || echo 'FAIL operational execution or evidence'
    [ "$ok" = 1 ]; return
  fi
  [ ! -f "$state_file" ] || prev=$(cat "$state_file")
  if [ "$ok" = 1 ]; then
    if [ "$prev" = down ]; then alert 'RECOVERED: operational host/worker/backlog/backup probes' || return 1; fi
    echo up > "$state_file"
  else
    if [ "$prev" != down ]; then alert 'DOWN: operational host/worker/backlog/backup probe failed' || return 1; fi
    echo down > "$state_file"
  fi
}
crisis_ok=0
if crisis_response=$(curl -sS --max-filesize 65536 -w '\n%{http_code}' -m 10 https://api.mento.chat/api/v1/health/crisis 2>/dev/null) && printf '%s' "$crisis_response" | "${PYTHON:-python3}" "$monitor_dir/classify-crisis-health.py" 2>/dev/null; then
  crisis_ok=1
fi
if [ "$CHECK_ONLY" = 1 ]; then
  if [ "$crisis_ok" = 1 ]; then
    echo 'PASS crisis-health semantic probe (not safety execution proof)'
  else
    echo 'FAIL crisis-health semantic probe'
    failures=1
  fi
  operational_check || failures=1
  exit "$failures"
fi
crisis_state_file="$STATE_DIR/api-crisis-reachable"
prev_crisis="unknown"
[ -f "$crisis_state_file" ] && prev_crisis="$(cat "$crisis_state_file")"
if [ "$crisis_ok" != 1 ]; then
  if [ "$prev_crisis" != "down" ]; then alert "DOWN: crisis-health probe failed (transport, degraded or invalid response)" || exit 1; fi
  echo "down" > "$crisis_state_file"
else
  if [ "$prev_crisis" = "down" ]; then alert "RECOVERED: crisis-health probe returns an expected status (fresh or idle)" || exit 1; fi
  echo "up" > "$crisis_state_file"
fi
operational_check || failures=1
exit "$failures"
