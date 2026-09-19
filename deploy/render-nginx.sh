#!/usr/bin/env bash
# Render one Nginx site from its template + deploy/domains.env, to stdout.
#   deploy/render-nginx.sh app                > mento-app.conf
#   deploy/render-nginx.sh admin              > mento-admin.conf
#   deploy/render-nginx.sh legacy <host>      > mento-legacy-<host>.conf   (301s)
#   deploy/render-nginx.sh apex               > mento-apex.conf            (302s)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck source=domains.env
. "$HERE/domains.env"
set +a

kind="${1:?usage: render-nginx.sh app|admin|legacy <host>|apex}"
case "$kind" in
    app)    tpl=mento-app.conf.template;      site="$APP_HOST";   code=301 ;;
    admin)  tpl=mento-admin.conf.template;    site="$ADMIN_HOST"; code=301 ;;
    legacy) tpl=mento-redirect.conf.template; site="${2:?legacy needs a host}"; code=301 ;;
    apex)   tpl=mento-redirect.conf.template; site="$ROOT_DOMAIN"; code=302 ;;
    *) echo "render-nginx: unknown kind '$kind'" >&2; exit 2 ;;
esac

# SITE_HOST first: APP_HOST/ADMIN_HOST are distinct tokens, never substrings of it.
sed -e "s/SITE_HOST/${site}/g" \
    -e "s/APP_HOST/${APP_HOST}/g" \
    -e "s/ADMIN_HOST/${ADMIN_HOST}/g" \
    -e "s/REDIRECT_CODE/${code}/g" \
    "$HERE/nginx/$tpl"
