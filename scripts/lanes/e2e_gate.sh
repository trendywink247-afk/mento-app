#!/usr/bin/env bash
# Full e2e gate: every spec, seats reset + Redis flushed before each, results in e2e_gate.log
ROOT=/c/Users/khana/Desktop/Mento
OUT="${MENTO_GATE_OUT:-/tmp/mento-e2e-gate}"
mkdir -p "$OUT"; : > "$OUT/summary.txt"
export NODE_PATH="$HOME/.claude/skills/playwright-skill/node_modules"
export MENTO_WEB=http://localhost:8081 MENTO_DB="${MENTO_DB:-mento}" MENTO_REDIS_DB="${MENTO_REDIS_DB:-0}"
psqlc() { docker exec mento-postgres psql -U mento -d mento -t -A -c "$1"; }
reset() {
  docker exec mento-redis redis-cli FLUSHDB >/dev/null
  psqlc "UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;" >/dev/null
}
cd "$ROOT/services/api"
TOKEN=$(./.venv/Scripts/python.exe -m scripts.issue_admin_token --owner --name "e2e-gate" 2>/dev/null | grep -o 'token=[A-Za-z0-9._-]*' | head -1 | sed 's/token=//')
export MENTO_ADMIN_TOKEN="$TOKEN" ADMIN_TOKEN="$TOKEN"
cd "$ROOT/apps/mobile"
SPECS="${SPECS:-$(ls e2e/*.e2e.js | grep -v two-party-chat)}"
for spec in $SPECS; do
  name=$(basename "$spec" .e2e.js); reset
  timeout 900 node "$spec" > "$OUT/$name.log" 2>&1; code=$?
  echo "$name exit=$code :: $(grep -v '^\s*$' "$OUT/$name.log" | tail -1 | cut -c1-160)" | tee -a "$OUT/summary.txt"
done
if [ -z "$SKIP_TWO_PARTY" ]; then
  reset
  psqlc "UPDATE listener_profiles SET status='away' WHERE community_slug IS NOT NULL;" >/dev/null
  psqlc "UPDATE listener_profiles SET status='online' WHERE community_slug IS NULL;" >/dev/null
  export LISTENER_ID=$(psqlc "SELECT id FROM listener_profiles WHERE status='online' LIMIT 1;" | tr -d '[:space:]')
  timeout 900 node e2e/two-party-chat.e2e.js > "$OUT/two-party-chat.log" 2>&1; code=$?
  echo "two-party-chat exit=$code :: $(grep -v '^\s*$' "$OUT/two-party-chat.log" | tail -1 | cut -c1-160)" | tee -a "$OUT/summary.txt"
fi
for t in test:question test:route; do npm run -s $t > "$OUT/$t.log" 2>&1; echo "$t exit=$? :: $(tail -1 "$OUT/$t.log")" | tee -a "$OUT/summary.txt"; done
reset
echo "GATE DONE" | tee -a "$OUT/summary.txt"
