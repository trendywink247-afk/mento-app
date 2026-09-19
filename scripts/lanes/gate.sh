#!/usr/bin/env bash
# The gate, in two tiers, with the browser walkthroughs run in parallel.
#
#   bash scripts/lanes/gate.sh fast     # the core loop: what runs before a normal deploy (~8 min)
#   bash scripts/lanes/gate.sh full     # every spec (before a big merge, or overnight)
#   bash scripts/lanes/gate.sh fast e2e/chat-header.e2e.js …   # fast + named extras
#
# Needs: the dev API on :8000 and Expo on :8081 (started WITHOUT CI), Docker up.
# The browser specs share the dev database (the API on :8000 is bound to it); seats are reset
# once up front and Redis is flushed periodically. pytest runs across 4 processes, each on
# its own database (see tests/conftest.py).
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${MENTO_GATE_OUT:-/tmp/mento-gate}"
TIER="${1:-fast}"; shift || true
WORKERS="${MENTO_GATE_WORKERS:-3}"
PY="$ROOT/services/api/.venv/Scripts/python.exe"
mkdir -p "$OUT"; : > "$OUT/summary.txt"
export NODE_PATH="${NODE_PATH:-$HOME/.claude/skills/playwright-skill/node_modules}"
export MENTO_WEB="${MENTO_WEB:-http://localhost:8081}"

# The core loop: sign up → chat → the four tabs → the mentor path → Hindi → wide screens,
# plus the guarantees that protect people (crisis, identity, erasure) which live in pytest.
FAST_SPECS="e2e/connecting-experience.e2e.js e2e/conversation-port.e2e.js e2e/tabs-port.e2e.js e2e/mentor-path.e2e.js e2e/member-screens.e2e.js e2e/hindi-core-loop.e2e.js e2e/desktop-frame.e2e.js e2e/chat-header.e2e.js"

say() { echo "$*" | tee -a "$OUT/summary.txt"; }
psqlc() { docker exec mento-postgres psql -U mento -d "${1}" -t -A -c "${2}" >/dev/null 2>&1; }

# --- tier 1: the checks that need no browser, all at once -----------------------------
( cd "$ROOT/services/api" && DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" \
    REDIS_URL="redis://localhost:6379/1" "$PY" -m pytest -q -p xdist -n 4 > "$OUT/pytest.log" 2>&1; \
  echo "pytest exit=$? :: $(tail -1 "$OUT/pytest.log")" >> "$OUT/summary.txt" ) &
PY_PID=$!
( cd "$ROOT/apps/mobile" && npx tsc --noEmit > "$OUT/tsc.log" 2>&1; echo "tsc exit=$? :: $(tail -1 "$OUT/tsc.log")" >> "$OUT/summary.txt" ) &
TSC_PID=$!
( cd "$ROOT/services/api" && "$PY" -m alembic check > "$OUT/alembic.log" 2>&1; echo "alembic exit=$? :: $(tail -1 "$OUT/alembic.log")" >> "$OUT/summary.txt" ) &
AL_PID=$!

# --- the spec list --------------------------------------------------------------------
cd "$ROOT/apps/mobile"
if [ "$TIER" = full ]; then SPECS="$(ls e2e/*.e2e.js)"; else SPECS="$FAST_SPECS $*"; fi

# One admin token, minted against the dev database (several specs need it).
TOKEN=$(cd "$ROOT/services/api" && "$PY" -m scripts.issue_admin_token --owner --name gate 2>/dev/null \
  | grep -o 'token=[A-Za-z0-9._-]*' | head -1 | sed 's/token=//')
export MENTO_ADMIN_TOKEN="$TOKEN" ADMIN_TOKEN="$TOKEN"

# --- the browser workers share the dev database (the API on :8000 is bound to it) ---------
# Reset ONCE here rather than per spec: with 3 specs in flight a per-spec reset would pull
# the ground out from under the other two. Seats are plentiful (every seeded mentor is free),
# and a background flush keeps the per-IP onboarding limit from tripping a long run.
docker exec mento-redis redis-cli -n 0 FLUSHDB >/dev/null 2>&1
docker exec mento-postgres psql -U mento -d mento -c   "UPDATE listener_profiles SET status='online', last_seen_at=NULL, active_conversations=0;" >/dev/null 2>&1
( while :; do sleep 45; docker exec mento-redis redis-cli -n 0 FLUSHDB >/dev/null 2>&1; done ) &
FLUSHER=$!
trap 'kill $FLUSHER 2>/dev/null' EXIT

run_spec() {
  local spec="$1" name code
  name=$(basename "$spec" .e2e.js)
  MENTO_DB=mento MENTO_REDIS_DB=0 MENTO_API="${MENTO_API:-http://localhost:8000/api/v1}"     timeout 900 node "$spec" > "$OUT/$name.log" 2>&1
  code=$?
  echo "$name exit=$code :: $(grep -v '^[[:space:]]*$' "$OUT/$name.log" | tail -1 | cut -c1-140)" >> "$OUT/summary.txt"
}

for spec in $SPECS; do
  run_spec "$spec" &
  # keep at most WORKERS browsers alive at once
  while [ "$(jobs -rp | wc -l)" -ge "$((WORKERS + 3))" ]; do sleep 2; done
done
wait $PY_PID $TSC_PID $AL_PID 2>/dev/null
wait
( cd "$ROOT/apps/mobile" && for t in test:placement test:question test:route; do
    npm run -s $t > "$OUT/$t.log" 2>&1; echo "$t exit=$? :: $(tail -1 "$OUT/$t.log")" >> "$OUT/summary.txt"; done )

fails=$(grep -c "exit=[^0]" "$OUT/summary.txt")
say "GATE DONE ($TIER) — $(grep -c 'exit=0' "$OUT/summary.txt") ok, $fails failed"
grep "exit=[^0]" "$OUT/summary.txt" || true
exit $(( fails > 0 ))
