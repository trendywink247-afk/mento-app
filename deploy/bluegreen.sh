#!/usr/bin/env bash
# Blue/green swap of the API on the Balanced stack (WS1 T1.9). Called by
# deploy/deploy.sh (MENTO_STACK=balanced) AFTER migrations have succeeded; never
# runs migrations itself.
#
#   COMPOSE_FILE=deploy/compose.base.yml:deploy/compose.prod.yml deploy/bluegreen.sh <image-tag>
#
# 1. Start the idle colour on mento-api:<tag> and wait for its healthcheck
#    (/api/v1/health/ready) — the live colour keeps serving the whole time.
# 2. Give Caddy one active-health interval to see it (deploy/caddy/Caddyfile).
# 3. Stop the old colour gracefully. Caddy sends new requests to the first healthy
#    upstream and retries a request that finds the old colour gone, so no request
#    fails during the swap.
# If step 1 fails, the new colour is removed and the old one is untouched.
# Prints the new live colour on success. A readiness failure preserves the old
# colour; failures after activation require inspection, not a no-change claim.
set -euo pipefail

TAG="${1:?usage: bluegreen.sh <image-tag>}"
: "${COMPOSE_FILE:?set COMPOSE_FILE to the compose files of the stack, colon-separated}"
export COMPOSE_FILE API_TAG="$TAG"
STATE_DIR="${MENTO_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/mento}"
WAIT_TIMEOUT="${MENTO_SWAP_WAIT:-180}"
# Caddy's health_interval is 2s; wait a little over two intervals.
CADDY_SETTLE="${MENTO_CADDY_SETTLE:-5}"

log() { echo "[bluegreen] $*" >&2; }
# MENTO_ENV_FILE (exported by deploy.sh) is also compose's interpolation source.
dc() { docker compose ${MENTO_ENV_FILE:+--env-file "$MENTO_ENV_FILE"} --profile green "$@"; }

running() { dc ps --status running --services 2>/dev/null | grep -qx "$1"; }

# State storage must be available before starting/removing any API containers.
mkdir -p "$STATE_DIR"
state_tmp=$(mktemp "$STATE_DIR/.live-colour.XXXXXX")
trap 'rm -f -- "$state_tmp"' EXIT
live=""
if running api_blue && running api_green; then
    # An interrupted earlier swap: trust the recorded colour, else keep blue.
    if [ -e "$STATE_DIR/live-colour" ]; then
        live="$(cat "$STATE_DIR/live-colour" 2>/dev/null)" \
            || { log 'Cannot read interrupted-swap state; inspect both APIs before retrying'; exit 1; }
    else
        live=api_blue
    fi
    case "$live" in
        api_blue|api_green) ;;
        *) log 'Invalid interrupted-swap colour state; inspect both APIs before retrying'; exit 1 ;;
    esac
elif running api_blue; then live=api_blue
elif running api_green; then live=api_green
fi
case "$live" in
    api_blue) idle=api_green ;;
    *)        idle=api_blue ;;
esac
log "live: ${live:-none}; starting $idle on mento-api:$TAG"

if ! dc up -d --no-deps --no-build --force-recreate --wait --wait-timeout "$WAIT_TIMEOUT" "$idle"; then
    log "FAILED: $idle never became healthy on mento-api:$TAG — removing it; ${live:-nothing} still serving"
    dc logs --tail 40 "$idle" >&2 || true
    dc rm -f -s "$idle" >/dev/null 2>&1 || true
    exit 1
fi
log "$idle healthy"

if [ -n "$live" ]; then
    sleep "$CADDY_SETTLE"
    log "stopping $live"
    dc stop -t 30 "$live" >/dev/null
    dc rm -f "$live" >/dev/null
fi

printf '%s\n' "$idle" > "$state_tmp"
mv -f -- "$state_tmp" "$STATE_DIR/live-colour"
log "live: $idle on mento-api:$TAG"
echo "$idle"
