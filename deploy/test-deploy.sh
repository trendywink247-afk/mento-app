#!/usr/bin/env bash
# Proof for deploy/deploy.sh + deploy/bluegreen.sh (WS1 T1.9), end to end, on
# THIS machine — never on a server. It builds a fake box: a bare "origin" holding
# a snapshot of the current working tree, a clone of it standing in for
# /opt/mento, and a throwaway env file. Then it drives the real deploy.sh through
# both stacks while request loops run, and asserts:
#
#   balanced  a good deploy swaps blue -> green with zero failed requests; a broken
#             migration fails the deploy and the old colour keeps serving; a
#             migration blocked by a held lock gives up after lock_timeout (3 s)
#             and fails the deploy; --rollback puts the previous image back with
#             zero failed requests; the forced command refuses anything but
#             "deploy <40-hex sha on origin/master>".
#   legacy    (today's prod stack) a broken migration leaves the api untouched; an
#             image that never turns healthy is rolled back to the previous tag.
#
#   bash deploy/test-deploy.sh [balanced|legacy|all]
#
# Needs Docker with compose v2, and free ports 80, 443 and 127.0.0.1:8000. Stop the
# local stack first (it shares container names). If `docker compose build` has no
# network on this machine, pre-build instead: TEST_PREBUILD_ARGS="--network host ..."
# (deploy.sh skips the build when mento-api:<sha> already exists).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WHICH="${1:-all}"
# The real deploy script prunes mento-api images. Never run this rehearsal on a
# daemon holding application images, even if their containers are stopped.
existing_images="$(docker image ls --format '{{.Repository}}:{{.Tag}}' mento-api)"
if [ -n "$existing_images" ]; then
    echo 'Use a disposable Docker daemon: existing mento-api images must be preserved.' >&2
    exit 2
fi
existing_projects="$(docker ps -aq --filter label=com.docker.compose.project=mento-deploytest --filter label=com.docker.compose.project=mento-deploytest-legacy)"
if [ -n "$existing_projects" ]; then
    echo 'Existing deployment-test containers found; inspect them before rehearsal.' >&2
    exit 2
fi
TMP="$(mktemp -d)"
REMOTE="$TMP/origin.git"; BOX="$TMP/box"; DEV="$TMP/dev"
export MENTO_STATE_DIR="$TMP/state"
unset MENTO_ENV_FILE COMPOSE_FILE
fails=0
ok()   { echo "ok   $*"; }
fail() { echo "FAIL $*"; fails=$((fails+1)); }
note() { echo "---- $*"; }

for c in mento-postgres mento-redis mento-caddy mento-glitchtip mento-postgres-prod mento-redis-prod mento-api-prod mento-worker-prod; do
    if docker inspect "$c" >/dev/null 2>&1; then
        echo "container $c already exists — stop that stack first (this test reuses the names)"; exit 2
    fi
done

cleanup() {
    touch "$TMP/stop" 2>/dev/null || true
    wait 2>/dev/null || true
    for p in mento-deploytest mento-deploytest-legacy; do
        COMPOSE_PROJECT_NAME=$p COMPOSE_FILE="$BOX/deploy/compose.base.yml:$BOX/deploy/compose.prod.yml:$TMP/test.override.yml" \
            MENTO_ENV_FILE="$BOX/services/api/.env" POSTGRES_PASSWORD=x \
            docker compose --profile green --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
    done
    COMPOSE_PROJECT_NAME=mento-deploytest-legacy MENTO_ENV_FILE="$BOX/services/api/.env" \
        docker compose -f "$BOX/deploy/docker-compose.prod.yml" --env-file "$BOX/services/api/.env" \
        down -v --remove-orphans >/dev/null 2>&1 || true
    for t in "${TAGS[@]:-}"; do [ -n "$t" ] && docker image rm "mento-api:$t" >/dev/null 2>&1 || true; done
    docker image rm mento-api:pre-bluegreen >/dev/null 2>&1 || true
    rm -rf "$TMP"
}
TAGS=()
trap cleanup EXIT

# --- the fake box --------------------------------------------------------------
# Snapshot the working tree (tracked + untracked, minus ignored) without touching
# the real index or any branch.
export GIT_INDEX_FILE="$TMP/index"
git -C "$ROOT" read-tree HEAD
git -C "$ROOT" add -A
# The fake box must use only its generated test environment. Exclude the real
# encrypted production environment from this temporary index, never the checkout.
git -C "$ROOT" update-index --force-remove -- deploy/secrets/prod.env.sops.yaml
SNAP="$(git -C "$ROOT" commit-tree "$(git -C "$ROOT" write-tree)" -p HEAD -m "test-deploy snapshot")"
unset GIT_INDEX_FILE
git init -q --bare --initial-branch=master "$REMOTE"
git -C "$ROOT" push -q "$REMOTE" "$SNAP:refs/heads/master"
git clone -q "$REMOTE" "$BOX"
git clone -q "$REMOTE" "$DEV"
git -C "$DEV" config user.email test@deploy.local; git -C "$DEV" config user.name test-deploy
printf 'ENV=dev\nPOSTGRES_PASSWORD=test-deploy-pw\nJWT_SECRET=test-deploy\nGLITCHTIP_SECRET_KEY=synthetic-rehearsal-only-not-production\nUVICORN_WORKERS=1\n' \
    > "$BOX/services/api/.env"
mkdir -p "$TMP/web/current"; echo SPA > "$TMP/web/current/index.html"
cat > "$TMP/test.override.yml" <<EOF
services:
  caddy:
    environment:
      CADDY_TLS: internal
    volumes:
      - $TMP/web:/srv/web:ro
EOF

prebuild() {  # prebuild <sha> — only when TEST_PREBUILD_ARGS is set
    local tag="${1:0:12}"
    TAGS+=("$tag")
    [ -n "${TEST_PREBUILD_ARGS:-}" ] || return 0
    rm -rf "$TMP/ctx"; mkdir -p "$TMP/ctx"
    git -C "$DEV" archive "$1" services/api | tar -x -C "$TMP/ctx"
    # shellcheck disable=SC2086
    docker build -q $TEST_PREBUILD_ARGS -t "mento-api:$tag" "$TMP/ctx/services/api" >/dev/null
}
commit() {  # commit <message> — commits whatever is staged in $DEV, pushes, prints the sha
    git -C "$DEV" commit -q -m "$1"
    git -C "$DEV" push -q origin master
    git -C "$DEV" rev-parse HEAD
}
deploy() { "$BOX/deploy/deploy.sh" "$@" > "$TMP/deploy.log" 2>&1; }
show_log() { sed 's/^/     | /' "$TMP/deploy.log" | tail -${1:-12}; }
head_rev() { docker exec mento-postgres${PG_SUFFIX:-} psql -U mento -d mento -tAc "select version_num from alembic_version"; }
migration() {  # migration <file> <revision> <down_revision> <upgrade body>
    cat > "$DEV/services/api/migrations/versions/$1" <<EOF
"""test-deploy: $2"""
from alembic import op

revision = "$2"
down_revision = "$3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    $4


def downgrade() -> None:
    pass
EOF
    git -C "$DEV" add "services/api/migrations/versions/$1"
}

# Request loops: 3 in parallel; every response is recorded. 000 (no answer), 502,
# 503 and 504 count as failures — anything else was served by the API.
start_load() {  # start_load <name> <curl args...>
    rm -f "$TMP/stop"; : > "$TMP/load-$1"
    for _ in 1 2 3; do
        ( while [ ! -f "$TMP/stop" ]; do
              curl -s -o /dev/null -m 10 --noproxy '*' -w '%{http_code}\n' "${@:2}" >> "$TMP/load-$1" || true
          done ) &
    done
}
stop_load() {  # stop_load <name> <label> <max failures allowed or "report">
    touch "$TMP/stop"; wait
    local total bad
    total="$(wc -l < "$TMP/load-$1")"
    bad="$(grep -cE '^(000|502|503|504)$' "$TMP/load-$1" || true)"
    if [ "$3" = report ]; then echo "info $2: $bad of $total requests failed (single-container recreate)"
    elif [ "$bad" -le "$3" ] && [ "$total" -gt 50 ]; then ok "$2: $bad of $total requests failed"
    else fail "$2: $bad of $total requests failed ($(sort "$TMP/load-$1" | uniq -c | tr '\n' ' '))"; fi
}

# --- balanced: compose.base + compose.prod + Caddy, blue/green -----------------------
balanced() {
    note "balanced stack"
    export MENTO_STACK=balanced COMPOSE_PROJECT_NAME=mento-deploytest MENTO_COMPOSE_EXTRA="$TMP/test.override.yml"
    set -a; . "$BOX/deploy/domains.env"; set +a
    local API="https://$API_HOST/api/v1/health/ready" A B C D E
    local RESOLVE=(--resolve "$API_HOST:443:127.0.0.1" -k)
    colour_tag() { docker inspect -f '{{.Config.Image}}' "mento-deploytest-$1-1" 2>/dev/null; }
    live() { cat "$MENTO_STATE_DIR/live-colour"; }

    A="$(git -C "$DEV" rev-parse HEAD)"; prebuild "$A"
    deploy && ok "first deploy (A) succeeds" || { fail "first deploy (A)"; show_log 30; return; }
    [ "$(live)" = api_blue ] && [ "$(colour_tag api_blue)" = "mento-api:${A:0:12}" ] \
        && ok "A is live on blue" || fail "after A: live=$(live) image=$(colour_tag api_blue)"
    [ "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "${RESOLVE[@]}" "$API")" = 200 ] \
        && ok "health/ready through Caddy" || fail "health/ready through Caddy"

    start_load bal "${RESOLVE[@]}" "$API"
    echo "deploytest B" > "$DEV/DEPLOYTEST.txt"; git -C "$DEV" add DEPLOYTEST.txt
    B="$(commit "B: a good change")"; prebuild "$B"
    deploy && ok "good deploy (B) succeeds" || { fail "good deploy (B)"; show_log; }
    [ "$(live)" = api_green ] && [ "$(colour_tag api_green)" = "mento-api:${B:0:12}" ] \
        && ok "B is live on green" || fail "after B: live=$(live) image=$(colour_tag api_green)"
    docker inspect mento-deploytest-api_blue-1 >/dev/null 2>&1 && fail "blue still exists after the swap" \
        || ok "blue stopped and removed"

    local HEAD; HEAD="$(head_rev)"
    migration zz_deploytest_broken.py deploytest_broken "$HEAD" 'op.execute("SELECT * FROM deploytest_no_such_table")'
    C="$(commit "C: a broken migration")"; prebuild "$C"
    if deploy; then fail "broken migration (C) deployed"; show_log; else ok "broken migration (C) fails the deploy"; fi
    grep -q "migration FAILED" "$TMP/deploy.log" && ok "…at the migration step" || { fail "C failed elsewhere"; show_log; }
    [ "$(live)" = api_green ] && [ "$(colour_tag api_green)" = "mento-api:${B:0:12}" ] \
        && ok "B still serving on green after C" || fail "after C: live=$(live) image=$(colour_tag api_green)"
    [ "$(head_rev)" = "$HEAD" ] && ok "schema unchanged after C" || fail "schema moved to $(head_rev)"

    git -C "$DEV" rm -q "services/api/migrations/versions/zz_deploytest_broken.py"
    migration zz_deploytest_lock.py deploytest_lock "$HEAD" \
        'op.add_column("users", __import__("sqlalchemy").Column("deploytest_col", __import__("sqlalchemy").Integer()))'
    D="$(commit "D: a migration that needs a lock live traffic holds")"; prebuild "$D"
    docker exec mento-postgres psql -U mento -d mento -c \
        "BEGIN; LOCK TABLE users IN ACCESS SHARE MODE; SELECT pg_sleep(60); COMMIT;" >/dev/null 2>&1 &
    local holder=$!
    sleep 2
    local t0=$SECONDS
    if deploy; then fail "locked migration (D) deployed"; else ok "locked migration (D) fails the deploy"; fi
    local took=$((SECONDS - t0))
    grep -qi "lock timeout" "$TMP/deploy.log" && ok "…on lock_timeout, after ${took}s (the lock was held for 60s)" \
        || { fail "D did not fail on lock_timeout"; show_log; }
    docker exec mento-postgres psql -U mento -d mento -tAc \
        "select pg_terminate_backend(pid) from pg_stat_activity where query like '%pg_sleep(60)%' and pid<>pg_backend_pid()" >/dev/null
    wait "$holder" 2>/dev/null || true
    [ "$(colour_tag api_green)" = "mento-api:${B:0:12}" ] && ok "B still serving after D" || fail "after D: $(colour_tag api_green)"

    git -C "$DEV" rm -q "services/api/migrations/versions/zz_deploytest_lock.py"
    echo "deploytest E" > "$DEV/DEPLOYTEST.txt"; git -C "$DEV" add DEPLOYTEST.txt
    E="$(commit "E: good again")"; prebuild "$E"
    deploy && ok "good deploy (E) succeeds" || { fail "good deploy (E)"; show_log; }
    [ "$(live)" = api_blue ] && [ "$(colour_tag api_blue)" = "mento-api:${E:0:12}" ] \
        && ok "E is live on blue (green -> blue)" || fail "after E: live=$(live) image=$(colour_tag api_blue)"

    deploy --rollback && ok "--rollback succeeds" || { fail "--rollback"; show_log; }
    [ "$(live)" = api_green ] && [ "$(colour_tag api_green)" = "mento-api:${B:0:12}" ] \
        && ok "rolled back to B on green" || fail "after rollback: live=$(live) image=$(colour_tag api_green)"
    stop_load bal "blue/green: 4 swaps + 2 failed deploys + a rollback" 0

    note "forced command (the CI key)"
    local bad
    for bad in "" "deploy" "deploy $B extra" "deploy ${B:0:12}" "deploy; id" "rm -rf /" "deploy \$(id)" \
               "deploy $(printf '%040d' 0)"; do
        if SSH_ORIGINAL_COMMAND="$bad" "$BOX/deploy/deploy.sh" --from-ssh >"$TMP/deploy.log" 2>&1; then
            fail "forced command accepted '$bad'"
        elif grep -q "backup first" "$TMP/deploy.log"; then
            fail "forced command '$bad' got as far as the backup"
        else ok "forced command refuses '$bad'"; fi
    done
    [ "$(colour_tag api_green)" = "mento-api:${B:0:12}" ] && ok "nothing changed through the refusals" \
        || fail "a refusal changed the stack"
    unset MENTO_STACK COMPOSE_PROJECT_NAME MENTO_COMPOSE_EXTRA
    cleanup_stack() { COMPOSE_PROJECT_NAME=mento-deploytest COMPOSE_FILE="$BOX/deploy/compose.base.yml:$BOX/deploy/compose.prod.yml:$TMP/test.override.yml" \
        MENTO_ENV_FILE="$BOX/services/api/.env" POSTGRES_PASSWORD=x \
        docker compose --profile green --profile tools down -v --remove-orphans >/dev/null 2>&1 || true; }
    cleanup_stack
    rm -rf "$MENTO_STATE_DIR"
}

# --- legacy: deploy/docker-compose.prod.yml (today's prod) ---------------------------
legacy() {
    note "legacy stack (today's prod)"
    export MENTO_STACK=legacy COMPOSE_PROJECT_NAME=mento-deploytest-legacy PG_SUFFIX=-prod
    git -C "$DEV" pull -q
    local A B C F URL=http://127.0.0.1:8000/api/v1/health/ready
    api_tag() { docker inspect -f '{{.Config.Image}}' mento-api-prod 2>/dev/null; }

    A="$(git -C "$DEV" rev-parse HEAD)"; prebuild "$A"
    # Pretend today's image: a container started the old way, with no mento-api:<sha> tag.
    deploy && ok "first deploy (A) succeeds" || { fail "first deploy (A)"; show_log 30; return; }
    [ "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$URL")" = 200 ] && ok "A healthy on :8000" || fail "A not healthy"

    echo "legacy B" > "$DEV/DEPLOYTEST.txt"; git -C "$DEV" add DEPLOYTEST.txt
    B="$(commit "legacy B")"; prebuild "$B"
    start_load leg "$URL"
    deploy && ok "good deploy (B) succeeds" || { fail "good deploy (B)"; show_log; }
    stop_load leg "legacy recreate A -> B" report
    [ "$(api_tag)" = "mento-api:${B:0:12}" ] && ok "B is live" || fail "live image $(api_tag)"

    local HEAD; HEAD="$(head_rev)"
    migration zz_deploytest_broken.py deploytest_broken "$HEAD" 'op.execute("SELECT * FROM deploytest_no_such_table")'
    C="$(commit "legacy C: broken migration")"; prebuild "$C"
    start_load leg "$URL"
    if deploy; then fail "broken migration (C) deployed"; else ok "broken migration (C) fails the deploy"; fi
    stop_load leg "legacy: failed migration, api untouched" 0
    [ "$(api_tag)" = "mento-api:${B:0:12}" ] && ok "B still live after C" || fail "live image $(api_tag)"

    git -C "$DEV" rm -q "services/api/migrations/versions/zz_deploytest_broken.py"
    printf '\nraise SystemExit("test-deploy: this image refuses to boot")\n' >> "$DEV/services/api/app/main.py"
    git -C "$DEV" add services/api/app/main.py
    F="$(commit "legacy F: an image that never turns healthy")"; prebuild "$F"
    if MENTO_SWAP_WAIT=60 deploy; then fail "unhealthy image (F) deployed"; show_log
    else ok "unhealthy image (F) fails the deploy"; fi
    grep -q "rolled back to ${B:0:12}" "$TMP/deploy.log" && ok "…and rolls back to B by tag" || { fail "no rollback"; show_log; }
    [ "$(api_tag)" = "mento-api:${B:0:12}" ] && [ "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$URL")" = 200 ] \
        && ok "B live and healthy after the rollback" || fail "after F: $(api_tag)"

    # The first ship after this script lands on the box: a container is running, but
    # nothing is recorded yet. A bad image must still find its way back.
    rm -rf "$MENTO_STATE_DIR"
    printf '\nraise SystemExit("test-deploy: still refuses to boot")\n' >> "$DEV/services/api/app/main.py"
    git -C "$DEV" add services/api/app/main.py
    local G; G="$(commit "legacy G: unhealthy, with no recorded tag")"; prebuild "$G"
    if MENTO_SWAP_WAIT=60 deploy; then fail "unhealthy image (G) deployed"; show_log
    else ok "first deploy with no recorded tag: unhealthy image (G) fails"; fi
    grep -q "rolled back to pre-bluegreen" "$TMP/deploy.log" && ok "…and rolls back to the image that was running" \
        || { fail "no rollback to the running image"; show_log; }
    [ "$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "$URL")" = 200 ] \
        && ok "healthy again on the image that was running" || fail "not healthy after G"
    unset MENTO_STACK COMPOSE_PROJECT_NAME PG_SUFFIX
}

case "$WHICH" in
    balanced) balanced ;;
    legacy) legacy ;;
    all) balanced; legacy ;;
    *) echo "usage: test-deploy.sh [balanced|legacy|all]"; exit 2 ;;
esac

[ "$fails" -eq 0 ] && echo "deploy proof: all assertions held" || { echo "deploy proof: $fails failure(s)"; exit 1; }
