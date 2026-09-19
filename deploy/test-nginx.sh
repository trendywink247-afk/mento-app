#!/usr/bin/env bash
# Proof for the rendered Nginx sites: run them in a throwaway nginx:1.22 (same
# line as the VPS) with the TLS lines stripped — location logic is byte-identical —
# and assert the host map of spec 2026-09-19-unified-domains §3.1 row by row.
# Needs Docker. Exit 0 = every assertion held.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; . "$HERE/domains.env"; set +a
NAME=mento-nginx-proof
PORT=18080
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/conf" "$TMP/root/_expo" "$TMP/root/assets"
echo "SPA-INDEX" > "$TMP/root/index.html"
echo "js" > "$TMP/root/_expo/app.js"

strip_tls() {
    sed -e "s/listen 443 ssl;/listen 8080;/" \
        -e "/ssl_certificate/d" -e "/ssl_dhparam/d" -e "/options-ssl-nginx/d" \
        -e "s#root /opt/mento-console/current;#root /usr/share/nginx/html;#"
}
"$HERE/render-nginx.sh" app   | strip_tls > "$TMP/conf/app.conf"
"$HERE/render-nginx.sh" admin | strip_tls > "$TMP/conf/admin.conf"
"$HERE/render-nginx.sh" apex  | strip_tls > "$TMP/conf/apex.conf"
for h in $LEGACY_HOSTS; do "$HERE/render-nginx.sh" legacy "$h" | strip_tls > "$TMP/conf/legacy-$h.conf"; done

# Git Bash needs a Windows path for the bind mount; elsewhere pwd -W does not exist.
WIN="$(cd "$TMP" && (pwd -W 2>/dev/null || pwd))"
docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" -p "$PORT:8080" \
    -v "$WIN/conf:/etc/nginx/conf.d:ro" -v "$WIN/root:/usr/share/nginx/html:ro" nginx:1.22 >/dev/null
docker exec "$NAME" nginx -t
# Wait for the listener without a sleep loop: curl retries refused connections itself.
curl -s -o /dev/null --retry 20 --retry-delay 1 --retry-connrefused \
    -H "Host: $APP_HOST" "http://localhost:$PORT/"

fails=0
# expect <host> <path> <code> [<Location suffix>]
expect() {
    local host=$1 path=$2 want=$3 loc=${4:-}
    local out code got
    out="$(curl -s -o /dev/null -m 5 -H "Host: $host" -w "%{http_code} %{redirect_url}" "http://localhost:$PORT$path")"
    code="${out%% *}"; got="${out#* }"
    if [ "$code" != "$want" ]; then echo "FAIL $host$path: code $code, want $want"; fails=$((fails+1)); return; fi
    if [ -n "$loc" ] && [ "${got%"$loc"}" = "$got" ]; then echo "FAIL $host$path: Location '$got', want …$loc"; fails=$((fails+1)); return; fi
    echo "ok   $host$path -> $code ${loc:+($loc)}"
}

# app host: the whole app, but never /admin, and assets stay strict
for p in / /onboarding /chat/abc /apply /signin /mentoring; do expect "$APP_HOST" "$p" 200; done
expect "$APP_HOST" /admin 404
expect "$APP_HOST" /admin/anything 404
expect "$APP_HOST" /_expo/app.js 200
expect "$APP_HOST" /_expo/missing.js 404
expect "$APP_HOST" /assets/missing.png 404

# admin host: only /admin (+ assets); the bare host lands on the dashboard
expect "$ADMIN_HOST" /admin 200
expect "$ADMIN_HOST" / 302 /admin
expect "$ADMIN_HOST" /onboarding 404
expect "$ADMIN_HOST" /chat/abc 404
expect "$ADMIN_HOST" /_expo/app.js 200

# legacy hosts: permanent redirects, path + query kept, /admin goes to the admin host
for h in $LEGACY_HOSTS; do
    expect "$h" / 301 "https://$APP_HOST/"
    expect "$h" /listener 301 "https://$APP_HOST/listener"
    expect "$h" "/apply?x=1" 301 "https://$APP_HOST/apply?x=1"
    expect "$h" /admin 301 "https://$ADMIN_HOST/admin"
done

# apex: temporary redirect (a marketing page may live here later)
expect "$ROOT_DOMAIN" / 302 "https://$APP_HOST/"

[ "$fails" -eq 0 ] && echo "nginx proof: all assertions held" || { echo "nginx proof: $fails failure(s)"; exit 1; }
