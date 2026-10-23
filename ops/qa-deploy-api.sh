#!/usr/bin/env bash
# QA entry point, kept so the documented command keeps working:
#
#   qa-deploy-api.sh <tag>        == deploy-api.sh qa <tag>
#   qa-deploy-api.sh --rollback   == deploy-api.sh qa --rollback
#
# The logic lives in ops/deploy-api.sh (installed as /usr/local/sbin/deploy-api).
set -euo pipefail

[ $# -eq 1 ] || { echo "usage: qa-deploy-api.sh <tag> | --rollback" >&2; exit 1; }

here="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
for candidate in "$here/deploy-api" "$here/deploy-api.sh"; do
    if [ -x "$candidate" ]; then
        exec "$candidate" qa "$1"
    fi
done
echo "qa-deploy-api: deploy-api not found next to $0" >&2
exit 1
