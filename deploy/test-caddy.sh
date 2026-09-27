#!/usr/bin/env bash
# Proof for deploy/caddy/Caddyfile: run it in a throwaway Caddy container (same
# image line as compose.base.yml) with Caddy's internal CA instead of ACME, and
# assert the host map deploy/test-nginx.sh asserts for the Nginx sites, row by row,
# plus a WebSocket upgrade through the API host. A WebSocket echo server stands in
# for the API as the `api_blue` upstream. Needs Docker. Exit 0 = every assertion held.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; . "$HERE/domains.env"; set +a
CADDY_IMAGE="${CADDY_IMAGE:-caddy:2.11-alpine}"
NET=mento-caddy-proof
NAME=mento-caddy-proof
UP=mento-caddy-proof-api
PORT=18443
TMP="$(mktemp -d)"
cleanup() {
    docker rm -f "$NAME" "$UP" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    rm -rf "$TMP"
}
trap cleanup EXIT

mkdir -p "$TMP/web/current/_expo" "$TMP/web/current/assets"
echo "SPA-INDEX" > "$TMP/web/current/index.html"
echo "js" > "$TMP/web/current/_expo/app.js"

CADDY_ENV=(-e "CADDY_TLS=internal" -e "ROOT_DOMAIN=$ROOT_DOMAIN" -e "APP_HOST=$APP_HOST"
           -e "API_HOST=$API_HOST" -e "ADMIN_HOST=$ADMIN_HOST")

# The file is valid and in Caddy's canonical format.
docker run --rm "${CADDY_ENV[@]}" -v "$HERE/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
    "$CADDY_IMAGE" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    || { echo "FAIL caddy validate"; docker run --rm "${CADDY_ENV[@]}" \
         -v "$HERE/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" \
         caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; exit 1; }
echo "ok   caddy validate"
docker run --rm -v "$HERE/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" \
    caddy fmt --diff /etc/caddy/Caddyfile >/dev/null 2>&1 \
    && echo "ok   caddy fmt (canonical)" || { echo "FAIL caddy fmt — run: caddy fmt --overwrite"; exit 1; }

docker network rm "$NET" >/dev/null 2>&1 || true
docker network create "$NET" >/dev/null
docker run -d --name "$UP" --network "$NET" --network-alias api_blue \
    -e PORT=8000 jmalloc/echo-server >/dev/null
docker run -d --name "$NAME" --network "$NET" -p "$PORT:443" "${CADDY_ENV[@]}" \
    -v "$HERE/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$TMP/web:/srv/web:ro" \
    "$CADDY_IMAGE" >/dev/null

# curl against the mapped port, with SNI + Host set to the real hostname.
c() {
    local host=$1; shift
    curl -sk -m 5 --noproxy '*' --resolve "$host:$PORT:127.0.0.1" "$@"
}
# Wait for TLS on the app host (internal certs are issued on first start).
for _ in $(seq 1 30); do c "$APP_HOST" -o /dev/null "https://$APP_HOST:$PORT/" && break; sleep 1; done

fails=0
# expect <host> <path> <code> [<Location suffix>]
expect() {
    local host=$1 path=$2 want=$3 loc=${4:-}
    local out code got
    out="$(c "$host" -o /dev/null -w "%{http_code} %{redirect_url}" "https://$host:$PORT$path")"
    code="${out%% *}"; got="${out#* }"
    if [ "$code" != "$want" ]; then echo "FAIL $host$path: code $code, want $want"; fails=$((fails+1)); return; fi
    if [ -n "$loc" ] && [ "${got%"$loc"}" = "$got" ]; then echo "FAIL $host$path: Location '$got', want …$loc"; fails=$((fails+1)); return; fi
    echo "ok   $host$path -> $code ${loc:+($loc)}"
}
body() {  # body <host> <path> <expected substring>
    if c "$1" "https://$1:$PORT$2" | grep -q "$3"; then echo "ok   $1$2 serves $3"
    else echo "FAIL $1$2 does not serve $3"; fails=$((fails+1)); fi
}

# app host: the whole app, but never /admin, and assets stay strict
for p in / /onboarding /chat/abc /apply /signin /mentoring; do expect "$APP_HOST" "$p" 200; done
body "$APP_HOST" /chat/abc SPA-INDEX
expect "$APP_HOST" /admin 404
expect "$APP_HOST" /admin/anything 404
expect "$APP_HOST" /_expo/app.js 200
expect "$APP_HOST" /_expo/missing.js 404
expect "$APP_HOST" /assets/missing.png 404

# admin host: only /admin (+ assets); the bare host lands on the dashboard
expect "$ADMIN_HOST" /admin 200
body "$ADMIN_HOST" /admin SPA-INDEX
expect "$ADMIN_HOST" / 302 /admin
expect "$ADMIN_HOST" /onboarding 404
expect "$ADMIN_HOST" /chat/abc 404
expect "$ADMIN_HOST" /_expo/app.js 200

# apex: temporary redirect, path + query kept, /admin to the admin host
expect "$ROOT_DOMAIN" / 302 "https://$APP_HOST/"
expect "$ROOT_DOMAIN" "/apply?x=1" 302 "https://$APP_HOST/apply?x=1"
expect "$ROOT_DOMAIN" /admin 302 "https://$ADMIN_HOST/admin"

# api host: proxied to the upstream
body "$API_HOST" /api/v1/health "GET /api/v1/health"

# WebSocket: the upgrade handshake goes through the API host and back.
ws="$(c "$API_HOST" -o /dev/null -w '%{http_code}' --http1.1 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
    -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://$API_HOST:$PORT/ws" || true)"
if [ "$ws" = 101 ]; then echo "ok   $API_HOST/ws -> 101 (WebSocket upgrade proxied)"
else echo "FAIL $API_HOST/ws: code $ws, want 101"; fails=$((fails+1)); fi

[ "$fails" -eq 0 ] && echo "caddy proof: all assertions held" || { echo "caddy proof: $fails failure(s)"; exit 1; }
