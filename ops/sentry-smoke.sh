#!/usr/bin/env bash
# ops/sentry-smoke.sh <qa|prod> [api|app] [--dry-run] [--yes-prod]
# Send ONE clearly labelled test event ("mento sentry smoke test") to the Sentry project for an
# environment, to prove the DSN, the network path and the environment tag work. It is a plain
# HTTPS POST of one hand-built event: no member data, no SDK, nothing from the app.
#
# Keys are read BY NAME from $MENTO_SECRETS_DIR/<env>.env (default /srv/mento/mento-app/.secrets,
# kept out of the repo):
#     SENTRY_DSN               the API project's DSN for that environment
#     EXPO_PUBLIC_SENTRY_DSN   the app project's DSN for that environment
# A missing file or key is a no-op for that target (exit 0, "skipped"). A DSN is never printed;
# only its host and project id are. Production needs --yes-prod so it is never hit by accident.
set -euo pipefail

ENVNAME=${1:-}; shift || true
case "$ENVNAME" in qa|prod) ;; *) echo "usage: ops/sentry-smoke.sh <qa|prod> [api|app] [--dry-run] [--yes-prod]" >&2; exit 2;; esac
TARGETS=(api app); DRY=0; YES=0
for a in "$@"; do
  case "$a" in
    api|app) TARGETS=("$a") ;;
    --dry-run) DRY=1 ;;
    --yes-prod) YES=1 ;;
    *) echo "sentry-smoke: unknown argument $a" >&2; exit 2 ;;
  esac
done
if [ "$ENVNAME" = prod ] && [ "$DRY" = 0 ] && [ "$YES" = 0 ]; then
  echo "sentry-smoke: prod sends a real event to the production project; add --yes-prod (or --dry-run)" >&2; exit 2
fi

FILE=${MENTO_SECRETS_DIR:-/srv/mento/mento-app/.secrets}/$ENVNAME.env
[ -r "$FILE" ] || { echo "sentry-smoke: $FILE not found, nothing to do (Sentry is off for $ENVNAME)"; exit 0; }

rc=0
for t in "${TARGETS[@]}"; do
  if [ "$t" = api ]; then KEY=SENTRY_DSN; else KEY=EXPO_PUBLIC_SENTRY_DSN; fi
  DSN=$({ grep -m1 "^$KEY=" "$FILE" | cut -d= -f2- | tr -d '"'; } || true)
  if [ -z "$DSN" ]; then echo "sentry-smoke: $ENVNAME/$t: $KEY not set, skipped"; continue; fi
  SMOKE_DSN=$DSN SMOKE_ENV=$ENVNAME SMOKE_TARGET=$t SMOKE_DRY=$DRY python3 -I -c '
import json, os, sys, time, urllib.request, uuid
from urllib.parse import urlsplit

dsn = urlsplit(os.environ["SMOKE_DSN"])
env, target = os.environ["SMOKE_ENV"], os.environ["SMOKE_TARGET"]
project = dsn.path.strip("/")
if dsn.scheme != "https" or not dsn.username or not dsn.hostname or not project.isdigit():
    print(f"sentry-smoke: {env}/{target}: DSN is not of the form https://<key>@<host>/<project-id>")
    sys.exit(1)
url = f"https://{dsn.hostname}/api/{project}/envelope/"
if os.environ["SMOKE_DRY"] == "1":
    print(f"sentry-smoke: {env}/{target}: dry run, would POST to {dsn.hostname} project {project}")
    sys.exit(0)
event_id = uuid.uuid4().hex
event = {
    "event_id": event_id,
    "timestamp": time.time(),
    "platform": "other",
    "level": "info",
    "environment": "qa" if env == "qa" else "production",
    "logentry": {"message": f"mento sentry smoke test ({target}, {env}) - safe to ignore"},
    "tags": {"smoke_test": "true", "source": f"ops/sentry-smoke.sh/{target}"},
}
body = (json.dumps({"event_id": event_id, "dsn": os.environ["SMOKE_DSN"]}) + "\n"
        + json.dumps({"type": "event"}) + "\n" + json.dumps(event) + "\n").encode()
req = urllib.request.Request(url, data=body, method="POST", headers={
    "Content-Type": "application/x-sentry-envelope",
    "X-Sentry-Auth": f"Sentry sentry_version=7, sentry_client=mento-smoke/1, sentry_key={dsn.username}",
})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print(f"sentry-smoke: {env}/{target}: sent, HTTP {r.status}, event {event_id}, host {dsn.hostname} project {project}")
except Exception as exc:  # the DSN is never in this message
    code = getattr(exc, "code", "")
    why = exc.headers.get("X-Sentry-Error", "") if hasattr(exc, "headers") and exc.headers else ""
    print(f"sentry-smoke: {env}/{target}: FAILED ({type(exc).__name__} {code} {why})".rstrip())
    sys.exit(1)
' || rc=1
done
exit $rc
