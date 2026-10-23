#!/usr/bin/env bash
# Deploy an API image to QA on this box (run as root).
#
#   qa-deploy-api.sh <tag>        # deploy mento-api:<tag> (tag only, e.g. 0f1e133f175c)
#   qa-deploy-api.sh --rollback   # swap back to the tag saved in previous-api-tag
#
# Install (root):  install -o root -g root -m 755 ops/qa-deploy-api.sh /usr/local/sbin/qa-deploy-api
# Build the image first with ops/build-api.sh <sha>.
#
# Layout under /opt/mento-staging (same convention as qa-install-web.sh):
#   compose.yml            project mento-staging (base; its pinned image tag is stale and
#                          is always overridden)
#   ci.override.yml        sets image: mento-api:<tag> for api, worker and migrate
#   ci.override.yml.bak.*  copy taken before every rewrite
#   previous-api-tag       the tag live immediately before the last deploy/rollback
#   deploy-history.log     one line per deploy/rollback: time, tag, alembic revision
#                          before and after
#   ci.lock                flock'd for the whole run so two deploys cannot overlap
#
# Deploy: check image exists -> take ci.lock -> record schema revision -> back up and
# rewrite the override -> migrate with the SAME image through the real `api` service
# (compose network + env_file, not a bare docker run) -> recreate api+worker -> wait
# for HTTP 200 from the readiness URL for up to 60s -> otherwise roll back
# automatically and exit non-zero.
#
# WARNING: rollback swaps the image only. Alembic migrations are NOT undone. Under the
# expand/contract rules the old image must run on the new schema; the script prints the
# schema revision the old tag last ran with so you can see what you are returning to.
set -euo pipefail

ROOT_DIR=/opt/mento-staging
OVERRIDE="$ROOT_DIR/ci.override.yml"
PREV_FILE="$ROOT_DIR/previous-api-tag"
HISTORY="$ROOT_DIR/deploy-history.log"
LOCK="$ROOT_DIR/ci.lock"
HEALTH_URL="${QA_API_HEALTH_URL:-https://qa-api.mento.chat/api/v1/health/ready}"
HEALTH_TIMEOUT=60
IMAGE_REPO=mento-api
SERVICES=(api worker)

die() { echo "qa-deploy-api: $*" >&2; exit 1; }
say() { echo "qa-deploy-api: $*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

[ "$(id -u)" -eq 0 ] || die "must run as root"
cd "$ROOT_DIR" || die "no $ROOT_DIR"

compose() { docker compose -f compose.yml -f ci.override.yml "$@"; }

valid_tag() { [[ $1 =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]]; }

# Tag currently set for the api service in the override.
override_tag() {
    awk '/^  api:/ {f=1; next} f && /image:/ {sub(/.*mento-api:/, ""); gsub(/["[:space:]]/, ""); print; exit}' "$OVERRIDE"
}

# Rewrite every mento-api image line in the override to $1, via temp file + rename.
set_override_tag() {
    local tag=$1 tmp="$OVERRIDE.tmp.$$"
    sed -E "s#^([[:space:]]*image:[[:space:]]*)\"?${IMAGE_REPO}:[^[:space:]\"]+\"?#\1${IMAGE_REPO}:${tag}#" "$OVERRIDE" > "$tmp"
    local total matched
    total="$(grep -cE '^[[:space:]]*image:' "$tmp" || true)"
    matched="$(grep -cE "^[[:space:]]*image:[[:space:]]*${IMAGE_REPO}:${tag}\$" "$tmp" || true)"
    if [ "$total" -lt 1 ] || [ "$total" -ne "$matched" ]; then
        rm -f "$tmp"
        echo "override has $total image lines but $matched now use $tag" >&2
        return 1
    fi
    chmod --reference="$OVERRIDE" "$tmp"
    mv -f "$tmp" "$OVERRIDE"
}

write_file_atomic() { # <path> <content>
    local tmp="$1.tmp.$$"
    printf '%s\n' "$2" > "$tmp"
    mv -f "$tmp" "$1"
}

# Alembic revision the DB is at, using the image the override currently names.
db_revision() {
    local out
    out="$(compose run --rm --no-deps -T api alembic current 2>/dev/null | awk 'NF {print $1}' | tail -n 1)" || true
    echo "${out:-unknown}"
}

log_history() { # <action> <tag> <rev_before> <rev_after> <result>
    printf '%s action=%s tag=%s rev_before=%s rev_after=%s result=%s\n' \
        "$(now)" "$1" "$2" "$3" "$4" "$5" >> "$HISTORY"
}

# Schema revision recorded the last time <tag> was deployed successfully.
last_rev_for_tag() {
    [ -f "$HISTORY" ] || return 0
    grep -E " action=deploy tag=$1 .* result=ok\$" "$HISTORY" | tail -n 1 | sed -E 's/.* rev_after=([^ ]+) .*/\1/' || true
}

recreate_services() {
    compose up -d --no-deps "${SERVICES[@]}"
}

# 0 once HEALTH_URL answers 200 AND the running api container uses image $1.
wait_healthy() {
    local want="$1" deadline=$((SECONDS + HEALTH_TIMEOUT)) code cid img
    while [ "$SECONDS" -lt "$deadline" ]; do
        cid="$(compose ps -q api 2>/dev/null || true)"
        img=""
        [ -z "$cid" ] || img="$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
        code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
        if [ "$code" = 200 ] && [ "$img" = "$want" ]; then
            say "healthy: $HEALTH_URL -> 200 on $img"
            return 0
        fi
        sleep 2
    done
    say "NOT healthy after ${HEALTH_TIMEOUT}s (last http=${code:-none}, running image=${img:-none}, want $want)"
    return 1
}

take_lock() {
    exec 9>>"$LOCK"
    flock -n 9 || die "another deploy holds $LOCK — not starting"
}

do_deploy() {
    local tag=$1 image="$IMAGE_REPO:$1" current ts backup prev_saved had_prev rev_before rev_after
    valid_tag "$tag" || die "bad tag: $tag"
    docker image inspect "$image" >/dev/null 2>&1 || die "image $image not found locally — build it first (ops/build-api.sh)"
    take_lock
    [ -f "$OVERRIDE" ] || die "missing $OVERRIDE"

    current="$(override_tag)"
    [ -n "$current" ] || die "could not read the current api tag from $OVERRIDE"
    [ "$current" != "$tag" ] || die "$image is already the live tag — nothing to do"

    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$OVERRIDE.bak.$ts"
    had_prev=0
    if [ -f "$PREV_FILE" ]; then had_prev=1; prev_saved="$(cat "$PREV_FILE")"; else prev_saved=""; fi

    say "live: $IMAGE_REPO:$current  ->  deploying: $image"
    rev_before="$(db_revision)"
    say "schema revision before: $rev_before"

    cp -p "$OVERRIDE" "$backup"
    say "override backed up: $backup"

    # Undo override + previous-api-tag edits (containers untouched at this point).
    restore_files() {
        cp -p "$backup" "$OVERRIDE"
        if [ "$had_prev" -eq 1 ]; then write_file_atomic "$PREV_FILE" "$prev_saved"; else rm -f "$PREV_FILE"; fi
    }

    write_file_atomic "$PREV_FILE" "$current"
    if ! set_override_tag "$tag"; then
        restore_files
        log_history deploy "$tag" "$rev_before" "$rev_before" failed-override
        die "could not rewrite override; restored from $backup"
    fi
    compose config -q || { restore_files; log_history deploy "$tag" "$rev_before" "$rev_before" failed-config; die "compose config invalid; restored"; }

    say "migrating with $image (compose run api alembic upgrade head)"
    if ! compose run --rm --no-deps -T api alembic upgrade head; then
        restore_files
        log_history deploy "$tag" "$rev_before" "$(db_revision)" failed-migrate
        die "migration FAILED; override restored, running containers untouched. Check the schema revision before retrying."
    fi
    rev_after="$(db_revision)"
    say "schema revision after: $rev_after"

    say "recreating ${SERVICES[*]}"
    if recreate_services && wait_healthy "$image"; then
        log_history deploy "$tag" "$rev_before" "$rev_after" ok
        say "deployed $image (previous: $IMAGE_REPO:$current, saved in $PREV_FILE)"
        return 0
    fi

    say "deploy of $image FAILED health — rolling back automatically to $IMAGE_REPO:$current"
    say "WARNING: the migration above was NOT undone; schema is at $rev_after"
    cp -p "$backup" "$OVERRIDE"
    if [ "$had_prev" -eq 1 ]; then write_file_atomic "$PREV_FILE" "$prev_saved"; else rm -f "$PREV_FILE"; fi
    if recreate_services && wait_healthy "$IMAGE_REPO:$current"; then
        log_history deploy "$tag" "$rev_before" "$rev_after" failed-rolled-back
        die "rolled back to $IMAGE_REPO:$current (healthy). Schema stays at $rev_after."
    fi
    log_history deploy "$tag" "$rev_before" "$rev_after" failed-rollback-unhealthy
    die "ROLLBACK ALSO UNHEALTHY — QA api is down. Investigate now: cd $ROOT_DIR && docker compose -f compose.yml -f ci.override.yml ps/logs"
}

do_rollback() {
    local current prev image schema_now schema_then
    take_lock
    [ -f "$PREV_FILE" ] || die "no $PREV_FILE — nothing to roll back to"
    prev="$(cat "$PREV_FILE")"
    valid_tag "$prev" || die "bad tag in $PREV_FILE: $prev"
    image="$IMAGE_REPO:$prev"
    docker image inspect "$image" >/dev/null 2>&1 || die "image $image not found locally — cannot roll back"
    current="$(override_tag)"
    [ -n "$current" ] || die "could not read the current api tag from $OVERRIDE"
    [ "$current" != "$prev" ] || die "live tag already equals previous tag ($prev)"

    schema_now="$(db_revision)"
    schema_then="$(last_rev_for_tag "$prev")"
    say "WARNING: rollback swaps the image only; database migrations are NOT undone."
    say "         DB schema now: $schema_now; when $prev was last deployed it ran at: ${schema_then:-unknown (no history entry)}"
    [ -z "$schema_then" ] || [ "$schema_then" = "$schema_now" ] \
        || say "         schema differs: $prev must tolerate the newer schema (expand/contract rule)."

    cp -p "$OVERRIDE" "$OVERRIDE.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    set_override_tag "$prev" || die "could not rewrite override"
    # Swap, so a second --rollback undoes this one instead of pointing at itself.
    write_file_atomic "$PREV_FILE" "$current"
    say "rolling back: $IMAGE_REPO:$current -> $image"
    if recreate_services && wait_healthy "$image"; then
        log_history rollback "$prev" "$schema_now" "$schema_now" ok
        say "live: $image"
        return 0
    fi
    log_history rollback "$prev" "$schema_now" "$schema_now" unhealthy
    die "rollback to $image is NOT healthy — QA api may be down. No further automatic action taken."
}

case "${1:-}" in
    --rollback)
        [ $# -eq 1 ] || die "usage: qa-deploy-api.sh --rollback"
        do_rollback
        ;;
    "" | --help | -h)
        die "usage: qa-deploy-api.sh <tag> | --rollback"
        ;;
    *)
        [ $# -eq 1 ] || die "usage: qa-deploy-api.sh <tag>"
        do_deploy "${1#"$IMAGE_REPO":}"
        ;;
esac
