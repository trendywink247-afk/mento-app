#!/usr/bin/env bash
# Render only: no images, serving containers or external credentials.
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
printf 'ENV=staging\nJWT_SECRET=synthetic-only\n' > "$temp/api.env"
MENTO_ENV_FILE="$temp/api.env" POSTGRES_PASSWORD=synthetic-only GLITCHTIP_SECRET_KEY=synthetic-only \
MENTO_AUTHORITATIVE_DATABASE_URL='postgresql+psycopg://mento:synthetic-only@retained-db:5432/mento' \
MENTO_AUTHORITATIVE_REDIS_URL='redis://retained-cache:6379/0' MENTO_AUTHORITATIVE_NETWORK=retained-network \
docker compose -f "$HERE/compose.base.yml" -f "$HERE/compose.prod.yml" \
  -f "$HERE/compose.transition.override.yml" --profile green --profile tools \
  config --format json > "$temp/candidate.json"
PYTHONPATH="$HERE/../scripts/ci${PYTHONPATH:+:$PYTHONPATH}" python3 - "$temp/candidate.json" <<'PY'
import json, sys
from test_transition_preflight import expected, transition
config = json.load(open(sys.argv[1]))
assert not {'postgres', 'valkey', 'glitchtip', 'glitchtip-init-db'} & set(config['services'])
live = dict(pools=[dict(processes=2, pool_size=5, max_overflow=5, queue_pool=0)],
            max_connections=100, reserved=3)
result = transition.validate_candidate(config, expected(), live, headroom=5, other_connections=0)
assert result['required'] == 58 and result['server_limit'] == 100
print('PASS: rendered transition reuses authoritative DB/cache; old+new overlap 58/100')
PY
