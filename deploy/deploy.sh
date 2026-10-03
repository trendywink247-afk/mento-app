#!/usr/bin/env bash
# Ship one commit of the API on the box. Runs ON the VPS, from its checkout
# (/opt/mento). Safe to re-run; one deploy at a time (a lock refuses a second).
#
#   ./deploy/deploy.sh                  # deploy origin/master
#   ./deploy/deploy.sh <sha>            # deploy exactly this commit (40 hex, on origin)
#   ./deploy/deploy.sh --backup [<sha>] # take deploy/backup-postgres.sh first; abort if it fails
#   ./deploy/deploy.sh --rollback       # put the previous image back (no migrations)
#   ./deploy/deploy.sh --from-ssh       # forced command for the CI key (see api-deploy.yml):
#                                       #   reads "deploy <sha>" from SSH_ORIGINAL_COMMAND,
#                                       #   always backs up first
#
# Order, for every deploy (WS1 T1.9):
#   1. check out the commit; build mento-api:<sha> (skipped if that image exists);
#   2. run `alembic upgrade head` in a ONE-OFF container on the new image — the
#      serving container never migrates (services/api/docker-entrypoint.sh), and a
#      migration waits at most 3 s for a lock (migrations/env.py). If this fails the
#      deploy stops here and the old containers keep serving, untouched;
#   3. swap: on the Balanced stack a blue/green swap (deploy/bluegreen.sh); on the
#      legacy stack the one api container is recreated and, if it never turns
#      healthy, put back on the previous image tag.
#
# Stacks: MENTO_STACK=legacy (default — deploy/docker-compose.prod.yml behind host
# Nginx, today's prod) or balanced (compose.base.yml + compose.prod.yml + Caddy,
# after the server move). The value can also live in ~/.config/mento/stack.
#
# Env: deploy/secrets/prod.env.sops.yaml is decrypted to tmpfs when it exists
# (deploy/decrypt-env.sh); otherwise services/api/.env is used, as before.
#
# Everything runs inside main(): `git reset` rewrites this file mid-run, and bash
# reads a script as it goes — the function is parsed in full before anything runs.
set -euo pipefail

main() {
    local HERE ROOT STATE_DIR mode="deploy" backup=0 ref="" arg
    HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    ROOT="$(cd "$HERE/.." && pwd)"
    # A reviewed, root-owned CI copy can live outside the application checkout.
    # Keep helper scripts/Compose paths tied to the explicitly selected checkout.
    if [ -n "${MENTO_CHECKOUT_ROOT:-}" ]; then
        ROOT="$(cd "$MENTO_CHECKOUT_ROOT" && pwd)"
        HERE="$ROOT/deploy"
    fi
    STATE_DIR="${MENTO_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/mento}"
    cd "$ROOT"

    for arg in "$@"; do
        case "$arg" in
            --backup) backup=1 ;;
            --rollback) mode=rollback ;;
            --from-ssh)
                # Only "deploy <40-hex sha>" is accepted from the CI key; anything
                # else is refused before a single command runs.
                local -a words=()
                read -r -a words <<< "${SSH_ORIGINAL_COMMAND:-}"
                [ "${#words[@]}" -eq 2 ] && [ "${words[0]}" = deploy ] && [[ "${words[1]}" =~ ^[0-9a-f]{40}$ ]] \
                    || die "forced command: expected 'deploy <40-hex sha>', got '${SSH_ORIGINAL_COMMAND:-}'"
                ref="${words[1]}"; backup=1
                break ;;
            -*) die "unknown option $arg" ;;
            *) [[ "$arg" =~ ^[0-9a-f]{40}$ ]] || die "a commit must be 40 hex chars, got '$arg'"
               ref="$arg" ;;
        esac
    done

    local STACK="${MENTO_STACK:-$(cat "${XDG_CONFIG_HOME:-$HOME/.config}/mento/stack" 2>/dev/null || echo legacy)}"
    case "$STACK" in legacy|balanced) ;; *) die "MENTO_STACK must be legacy or balanced, got '$STACK'" ;; esac

    mkdir -p "$STATE_DIR"
    exec 9>"$STATE_DIR/deploy.lock"
    flock -n 9 || die "another deploy is running"

    if [ "$mode" = rollback ]; then rollback "$STACK"; return; fi

    log "fetching"
    git fetch --quiet origin
    # CI may only ship commits that are on origin/master.
    [ -z "$ref" ] || git merge-base --is-ancestor "$ref" origin/master 2>/dev/null \
        || die "$ref is not on origin/master — refusing"

    if [ "$backup" = 1 ]; then
        log "backup first"
        "$HERE/backup-postgres.sh" || die "backup failed — nothing deployed"
    fi

    git reset --quiet --hard "${ref:-origin/master}"
    local TAG; TAG="$(git rev-parse --short=12 HEAD)"
    log "commit $TAG ($STACK stack)"

    use_env_file
    compose_files "$STACK"
    export API_TAG="$TAG"

    if docker image inspect "mento-api:$TAG" >/dev/null 2>&1; then
        log "image mento-api:$TAG already built"
    else
        log "building mento-api:$TAG"
        dc build "$(api_service "$STACK")"
    fi

    log "starting the data services"
    dc up -d --wait postgres "$(redis_service "$STACK")"

    log "migrating (one-off container on mento-api:$TAG)"
    if ! dc run --rm --no-deps "$(migrate_service "$STACK")" alembic upgrade head; then
        die "migration FAILED — nothing swapped; the running API is untouched"
    fi

    if [ "$STACK" = balanced ]; then
        # The edge: start it if it is down, then load this commit's Caddyfile. A
        # reload is graceful, and Caddy keeps its running config if the new one is
        # invalid — so an invalid file stops the deploy before anything swaps.
        log "edge: caddy up + reload"
        dc up -d --no-deps caddy
        docker exec mento-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile \
            || die "Caddyfile rejected — nothing swapped; the running config and API are untouched"
    fi

    local prev; prev="$(cat "$STATE_DIR/api-tag" 2>/dev/null || true)"
    if [ -z "$prev" ] && [ "$STACK" = legacy ]; then
        # First deploy under this script: the running container's image has no
        # mento-api:<sha> tag yet. Tag it, so a failed swap still has a way back.
        local running_id; running_id="$(docker inspect -f '{{.Image}}' mento-api-prod 2>/dev/null || true)"
        if [ -n "$running_id" ]; then
            docker tag "$running_id" mento-api:pre-bluegreen
            prev=pre-bluegreen
            log "no recorded tag; the running image is now mento-api:$prev (rollback target)"
        fi
    fi
    log "swapping to mento-api:$TAG"
    if [ "$STACK" = balanced ]; then
        "$HERE/bluegreen.sh" "$TAG" >/dev/null || die "swap FAILED — the previous colour is still serving"
    else
        if ! dc up -d --no-deps --no-build --wait --wait-timeout "${MENTO_SWAP_WAIT:-180}" api; then
            log "api never turned healthy on $TAG"
            [ -n "$prev" ] && [ "$prev" != "$TAG" ] || die "no previous tag recorded — fix forward"
            log "rolling back to mento-api:$prev"
            API_TAG="$prev" dc up -d --no-deps --no-build --wait --wait-timeout "${MENTO_SWAP_WAIT:-180}" api \
                || die "ROLLBACK FAILED too — check: docker compose logs api"
            die "deploy failed; rolled back to $prev (the migration to $TAG stays applied)"
        fi
    fi

    [ -n "$prev" ] && [ "$prev" != "$TAG" ] && echo "$prev" > "$STATE_DIR/api-tag.previous"
    echo "$TAG" > "$STATE_DIR/api-tag"
    activate_worker_or_rollback "$TAG" "$prev" "$STACK"
    prune_images "$TAG" "$prev"
    log "healthy on $TAG"
}

log() { echo "[deploy] $*"; }
die() { echo "[deploy] $*" >&2; exit 1; }

use_env_file() {
    if [ -f deploy/secrets/prod.env.sops.yaml ]; then
        MENTO_ENV_FILE="$(deploy/decrypt-env.sh)"
        log "env: decrypted to tmpfs"
    else
        MENTO_ENV_FILE="$PWD/services/api/.env"
        log "env: services/api/.env"
    fi
    [ -f "$MENTO_ENV_FILE" ] || die "no env file at $MENTO_ENV_FILE"
    # Compose reads it twice: as the containers' env_file, and (--env-file, the same
    # file as before this script existed) for ${POSTGRES_PASSWORD} interpolation.
    export MENTO_ENV_FILE
}
# Every compose call: the stack's files come from COMPOSE_FILE (compose_files).
dc() { docker compose --env-file "$MENTO_ENV_FILE" "$@"; }

compose_files() {
    if [ "$1" = balanced ]; then
        COMPOSE_FILE="deploy/compose.base.yml:deploy/compose.prod.yml"
    else
        COMPOSE_FILE="deploy/docker-compose.prod.yml"
    fi
    # One extra override, appended last — deploy/test-deploy.sh uses it to swap ACME
    # for Caddy's internal CA. Unset on the box.
    COMPOSE_FILE="$COMPOSE_FILE${MENTO_COMPOSE_EXTRA:+:$MENTO_COMPOSE_EXTRA}"
    export COMPOSE_FILE
}
api_service()     { [ "$1" = balanced ] && echo migrate || echo api; }
migrate_service() { [ "$1" = balanced ] && echo migrate || echo api; }
redis_service()   { [ "$1" = balanced ] && echo valkey  || echo redis; }

rollback() {
    local stack=$1 prev
    prev="$(cat "$STATE_DIR/api-tag.previous" 2>/dev/null || true)"
    [ -n "$prev" ] || die "no previous tag recorded"
    docker image inspect "mento-api:$prev" >/dev/null 2>&1 || die "image mento-api:$prev is gone"
    use_env_file
    compose_files "$stack"
    log "rolling back to mento-api:$prev (no migrations run; the schema stays as it is)"
    if [ "$stack" = balanced ]; then
        "$HERE/bluegreen.sh" "$prev" >/dev/null || die "rollback swap FAILED — the current colour is still serving"
    else
        API_TAG="$prev" dc up -d --no-deps --no-build --wait --wait-timeout "${MENTO_SWAP_WAIT:-180}" api \
            || die "rollback FAILED — check: docker compose logs api"
    fi
    mv -f "$STATE_DIR/api-tag" "$STATE_DIR/api-tag.previous" 2>/dev/null || true
    echo "$prev" > "$STATE_DIR/api-tag"
    start_worker "$prev" || die "rollback API recovered but worker failed — operator recovery required"
    log "healthy on $prev"
}

# The job worker (WS4) follows the API onto the image that is now serving. After
# the swap, never before: its code must match the API that enqueues its jobs, and
# jobs simply wait in Postgres while it restarts. Startup failure returns to the
# caller, which restores both API and worker rather than leaving a partial release.
activate_worker_or_rollback() {
    local tag=$1 previous=$2 stack=$3
    if ! start_worker "$tag"; then
        [ -n "$previous" ] && [ "$previous" != "$tag" ] || die "worker failed and no distinct previous release exists — fix forward"
        log "worker failed; restoring the previous API and worker"
        rollback "$stack"
        die "deploy failed; restored $previous after worker startup failure"
    fi
}

start_worker() {
    log "worker onto mento-api:$1"
    API_TAG="$1" dc up -d --no-deps --no-build worker \
        || { log "job WORKER failed to start on $1"; return 1; }
}

# Keep the live and previous images (the rollback target); drop older ones.
prune_images() {
    local keep1=$1 keep2=${2:-} img
    docker image ls --format '{{.Repository}}:{{.Tag}}' 'mento-api' | while read -r img; do
        case "$img" in "mento-api:$keep1"|"mento-api:$keep2"|"mento-api:<none>") ;; *)
            docker image rm "$img" >/dev/null 2>&1 || true ;;
        esac
    done
}

main "$@"; exit
