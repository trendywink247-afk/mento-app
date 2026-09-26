#!/usr/bin/env bash
# External uptime monitor — runs on the OLD box (87.232.72.79), watching the NEW
# prod box (mento.chat) from outside, so it still fires if the whole new box goes
# down (the new box's own /opt/mento-monitor/healthcheck.sh can't catch that —
# it checks itself). No third-party account: alerts go to a private ntfy.sh topic.
#
# Install as a cron job on the OLD box:
#   */5 * * * * /opt/mento-backups/external-monitor.sh >> /opt/mento-backups/external-monitor.log 2>&1
set -u
NTFY_TOPIC="__NTFY_TOPIC__"
STATE_DIR=/opt/mento-backups/.monitor-state
mkdir -p "$STATE_DIR"

alert() {
  local msg="$1"
  curl -fsS -m 10 -d "$msg" "https://ntfy.sh/${NTFY_TOPIC}" >/dev/null 2>&1 || true
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
  local prev="unknown"
  [ -f "$state_file" ] && prev="$(cat "$state_file")"
  if [ "$code" = "$want" ]; then
    if [ "$prev" = "down" ]; then alert "RECOVERED: $name ($url) is back, got $code"; fi
    echo "up" > "$state_file"
  else
    if [ "$prev" != "down" ]; then alert "DOWN: $name ($url) -> $code (want $want)"; fi
    echo "down" > "$state_file"
  fi
}

check api-health  https://api.mento.chat/api/v1/health        200
check api-ready   https://api.mento.chat/api/v1/health/ready  200
check web-app     https://app.mento.chat/                     200
check web-admin   https://admin.mento.chat/admin               200

# health/crisis legitimately reports 503 "stale" whenever no real crisis-webhook
# message has passed through recently — that is expected, not an outage (see
# PROGRESS.md). Only page if the endpoint is unreachable outright, not merely stale.
crisis_code=$(curl -sS -o /dev/null -w '%{http_code}' -m 10 https://api.mento.chat/api/v1/health/crisis 2>/dev/null)
[ $? -eq 0 ] && [ -n "$crisis_code" ] || crisis_code="ERR"
crisis_state_file="$STATE_DIR/api-crisis-reachable"
prev_crisis="unknown"
[ -f "$crisis_state_file" ] && prev_crisis="$(cat "$crisis_state_file")"
if [ "$crisis_code" = "ERR" ]; then
  if [ "$prev_crisis" != "down" ]; then alert "DOWN: crisis-webhook endpoint unreachable (not just stale)"; fi
  echo "down" > "$crisis_state_file"
else
  if [ "$prev_crisis" = "down" ]; then alert "RECOVERED: crisis-webhook endpoint reachable again ($crisis_code)"; fi
  echo "up" > "$crisis_state_file"
fi
