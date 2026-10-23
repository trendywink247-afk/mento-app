#!/usr/bin/env bash
# Deploy an API image on this box (run as root). One script for QA and production.
#
#   deploy-api.sh <qa|prod> <tag>        # deploy mento-api:<tag> (tag only)
#   deploy-api.sh <qa|prod> --rollback   # swap back to the tag saved in previous-api-tag
#
# Install (root):  install -o root -g root -m 755 ops/deploy-api.sh /usr/local/sbin/deploy-api
#                  install -o root -g root -m 755 ops/qa-deploy-api.sh /usr/local/sbin/qa-deploy-api
# Build the image first with ops/build-api.sh <sha> (tag <shortsha>-r<N>).
#
# Per-env layout (state dir = ROOT_DIR):
#   qa    /opt/mento-staging   compose.yml + ci.override.yml, lock ci.lock
#   prod  /opt/mento           compose.prod-cutover.yml + prod.override.yml, lock deploy.lock,
#                              deploy.conf (root-owned, sourced: PROJECT, MENTO_ENV_FILE,
#                              optional MENTO_REPO / MENTO_BACKUP_DIR / MENTO_BACKUP_SCRIPT,
#                              NO_WORKER_TAGS = tags whose image has no job worker).
#   Both  <override>.bak.*   copy taken before every rewrite
#         previous-api-tag   the tag live immediately before the last deploy/rollback
#         deploy-history.log one line per deploy/rollback: time, tag, alembic revision
#                            before and after (prod adds the backup file and its sha256)
#
# Deploy: validate -> [prod: image built from a commit on origin/main] -> take the lock ->
# [prod: typed confirmation] -> [prod: fresh backup taken in THIS run] -> record schema
# revision -> back up and rewrite the override -> migrate with the SAME image through the
# real `api` service (compose network + env_file, not a bare docker run) -> recreate
# api+worker -> wait for HTTP 200 from the readiness URL for up to 60s -> otherwise roll
# back automatically and exit non-zero.
#
# prod gates, all of which must pass before anything is touched:
#   - the image's org.opencontainers.image.revision label (set by build-api.sh) is a full
#     sha, matches the tag's <shortsha>, and is an ancestor of origin/main in MENTO_REPO
#     (default /opt/mento/src, fetched over https just before the check);
#   - a backup taken in this run: non-empty, under 15 minutes old, passes `gzip -t`; its
#     sha256 goes to the history log and the console;
#   - the operator types `deploy prod <tag>`.
#
# WARNING: rollback swaps the image only. Alembic migrations are NOT undone and the
# database is NOT restored. Under the expand/contract rules the old image must run on the
# new schema. Restoring the pre-deploy backup is a manual step (docs/runbooks/prod-cutover.md).
set -euo pipefail

QA_ROOT=/opt/mento-staging
PROD_ROOT=/opt/mento
HEALTH_TIMEOUT=60
BACKUP_MAX_AGE=900
IMAGE_REPO=mento-api
REV_LABEL=org.opencontainers.image.revision

die() { echo "deploy-api: $*" >&2; exit 1; }
say() { echo "deploy-api: $*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
usage() { die "usage: deploy-api.sh <qa|prod> <tag> | deploy-api.sh <qa|prod> --rollback"; }

[ $# -eq 2 ] || usage
ENV_NAME=$1
ARG=$2
case "$ENV_NAME" in qa | prod) ;; *) usage ;; esac

[ "$(id -u)" -eq 0 ] || die "must run as root"

PROJECT_ARGS=()
ENV_FILE_ARGS=()
HIST_EXTRA=""
NO_WORKER_TAGS=""

configure_env() {
    case "$ENV_NAME" in
        qa)
            ROOT_DIR=$QA_ROOT
            BASE_COMPOSE=compose.yml
            OVERRIDE="$ROOT_DIR/ci.override.yml"
            LOCK="$ROOT_DIR/ci.lock"
            HEALTH_URL="${QA_API_HEALTH_URL:-https://qa-api.mento.chat/api/v1/health/ready}"
            ;;
        prod)
            ROOT_DIR=$PROD_ROOT
            local conf="$ROOT_DIR/deploy.conf"
            [ -f "$conf" ] || die "missing $conf (see docs/runbooks/prod-cutover.md)"
            # Sourced as root: it must be root-owned and not writable by anyone else.
            [ "$(stat -c '%u' "$conf")" -eq 0 ] || die "$conf must be owned by root"
            [ -z "$(find "$conf" -perm /022)" ] || die "$conf must not be group/world writable"
            PROJECT="" MENTO_ENV_FILE="" NO_WORKER_TAGS=""
            # shellcheck disable=SC1090
            . "$conf"
            [ -n "$PROJECT" ] || die "deploy.conf must set PROJECT (the existing compose project name)"
            [ -f "$MENTO_ENV_FILE" ] || die "deploy.conf MENTO_ENV_FILE does not exist"
            export MENTO_ENV_FILE
            PROJECT_ARGS=(-p "$PROJECT")
            ENV_FILE_ARGS=(--env-file "$MENTO_ENV_FILE")
            BASE_COMPOSE="$ROOT_DIR/compose.prod-cutover.yml"
            OVERRIDE="$ROOT_DIR/prod.override.yml"
            LOCK="$ROOT_DIR/deploy.lock"
            HEALTH_URL="${PROD_API_HEALTH_URL:-http://127.0.0.1:8000/api/v1/health/ready}"
            MENTO_REPO="${MENTO_REPO:-/opt/mento/src}"
            MENTO_BACKUP_DIR="${MENTO_BACKUP_DIR:-/opt/mento-backups}"
            MENTO_BACKUP_SCRIPT="${MENTO_BACKUP_SCRIPT:-/opt/mento/deploy/backup-postgres.sh}"
            ;;
    esac
    PREV_FILE="$ROOT_DIR/previous-api-tag"
    HISTORY="$ROOT_DIR/deploy-history.log"
    [ -f "$BASE_COMPOSE" ] || [ -f "$ROOT_DIR/$BASE_COMPOSE" ] || die "missing compose file $BASE_COMPOSE"
    [ -f "$OVERRIDE" ] || die "missing $OVERRIDE"
}

configure_env
cd "$ROOT_DIR" || die "no $ROOT_DIR"

compose() { docker compose "${PROJECT_ARGS[@]}" "${ENV_FILE_ARGS[@]}" -f "$BASE_COMPOSE" -f "$OVERRIDE" "$@"; }

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

# The commit an image was built from (build-api.sh label); empty if unlabelled.
image_rev() {
    docker image inspect --format "{{ index .Config.Labels \"$REV_LABEL\" }}" "$1" 2>/dev/null | grep -E '^[0-9a-f]{40}$' || true
}

# Export GIT_SHA (Sentry release tag) for the compose commands that follow.
use_image_sha() {
    GIT_SHA="$(image_rev "$1")"
    export GIT_SHA
}

# Alembic revision the DB is at, using the image the override currently names.
db_revision() {
    local out
    out="$(compose run --rm --no-deps -T api alembic current 2>/dev/null | awk 'NF {print $1}' | tail -n 1)" || true
    echo "${out:-unknown}"
}

log_history() { # <action> <tag> <rev_before> <rev_after> <result>
    printf '%s env=%s action=%s tag=%s rev_before=%s rev_after=%s result=%s%s\n' \
        "$(now)" "$ENV_NAME" "$1" "$2" "$3" "$4" "$5" "$HIST_EXTRA" >> "$HISTORY"
}

# Schema revision recorded the last time <tag> was deployed successfully.
last_rev_for_tag() {
    [ -f "$HISTORY" ] || return 0
    grep -E " action=deploy tag=$1 rev_before=[^ ]+ rev_after=[^ ]+ result=ok( |\$)" "$HISTORY" \
        | tail -n 1 | sed -E 's/.* rev_after=([^ ]+) .*/\1/' || true
}

# Tags (space-separated, from deploy.conf NO_WORKER_TAGS) whose image predates the job
# worker. Recreating api on one of them must not start a worker that would crash-loop.
recreate_services() { # <tag of the image being started>
    case " $NO_WORKER_TAGS " in
        *" $1 "*)
            say "$1 predates the worker: starting api only and stopping the worker"
            compose up -d --no-deps api && { compose stop worker || true; }
            ;;
        *) compose up -d --no-deps api worker ;;
    esac
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

# --- prod-only gates ----------------------------------------------------------

# The image must come from a commit that is on origin/main of the root-owned clone.
require_from_main() { # <tag> <image>
    local tag=$1 image=$2 rev
    [[ $tag =~ ^[0-9a-f]{12}-r[0-9]+$ ]] || die "prod tags must look like <12-hex-sha>-r<N> (built by ops/build-api.sh), got: $tag"
    rev="$(image_rev "$image")"
    [ -n "$rev" ] || die "$image has no $REV_LABEL label — not built by ops/build-api.sh; refusing"
    [ "${rev:0:12}" = "${tag:0:12}" ] || die "tag $tag does not match the image's recorded commit $rev"
    [ -d "$MENTO_REPO/.git" ] || [ -f "$MENTO_REPO/HEAD" ] || die "no git clone at $MENTO_REPO"
    git -C "$MENTO_REPO" fetch --quiet origin main || die "git fetch origin main failed in $MENTO_REPO — cannot prove the commit is on main"
    git -C "$MENTO_REPO" cat-file -e "$rev^{commit}" 2>/dev/null || die "commit $rev is not in $MENTO_REPO after fetch"
    git -C "$MENTO_REPO" merge-base --is-ancestor "$rev" origin/main \
        || die "commit $rev is NOT on origin/main — merge it to main first"
    say "commit $rev is on origin/main"
}

confirm() { # <phrase>
    local reply
    printf 'deploy-api: type "%s" to continue: ' "$1"
    read -r reply || [ -n "$reply" ] || die "no confirmation received"
    [ "$reply" = "$1" ] || die "confirmation mismatch — nothing changed"
}

# A backup taken during THIS run. Sets BACKUP_FILE and BACKUP_SHA.
take_backup() {
    local marker newest mtime age sha
    [ -x "$MENTO_BACKUP_SCRIPT" ] || die "backup script $MENTO_BACKUP_SCRIPT is not executable"
    marker="$(mktemp)"
    say "taking backup via $MENTO_BACKUP_SCRIPT"
    if ! "$MENTO_BACKUP_SCRIPT"; then
        rm -f "$marker"
        die "backup FAILED (including its off-box copy) — not deploying"
    fi
    newest="$(find "$MENTO_BACKUP_DIR" -maxdepth 1 -name 'mento-*.sql.gz' -newer "$marker" -printf '%T@ %p\n' | sort -n | tail -n 1 | cut -d' ' -f2-)"
    rm -f "$marker"
    [ -n "$newest" ] || die "no new backup file appeared in $MENTO_BACKUP_DIR — not deploying"
    [ -s "$newest" ] || die "backup $newest is empty — not deploying"
    mtime="$(stat -c %Y "$newest")"
    age=$(($(date +%s) - mtime))
    [ "$age" -le "$BACKUP_MAX_AGE" ] || die "backup $newest is ${age}s old (max ${BACKUP_MAX_AGE}s) — not deploying"
    gzip -t "$newest" || die "backup $newest failed gzip -t — not deploying"
    sha="$(sha256sum "$newest" | cut -d' ' -f1)"
    BACKUP_FILE=$newest
    BACKUP_SHA=$sha
    HIST_EXTRA=" backup=$(basename "$newest") sha256=$sha"
    say "backup OK: $newest ($(stat -c %s "$newest") bytes, ${age}s old)"
    say "backup sha256: $sha"
}

# --- deploy / rollback ----------------------------------------------------------

do_deploy() {
    local tag=$1 image="$IMAGE_REPO:$1" current ts backup prev_saved had_prev rev_before rev_after
    valid_tag "$tag" || die "bad tag: $tag"
    docker image inspect "$image" >/dev/null 2>&1 || die "image $image not found locally — build it first (ops/build-api.sh)"
    [ "$ENV_NAME" != prod ] || require_from_main "$tag" "$image"
    take_lock

    current="$(override_tag)"
    [ -n "$current" ] || die "could not read the current api tag from $OVERRIDE"
    [ "$current" != "$tag" ] || die "$image is already the live tag — nothing to do"

    say "[$ENV_NAME] live: $IMAGE_REPO:$current  ->  deploying: $image"
    [ "$ENV_NAME" != prod ] || confirm "deploy prod $tag"
    [ "$ENV_NAME" != prod ] || take_backup

    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    backup="$OVERRIDE.bak.$ts"
    had_prev=0
    if [ -f "$PREV_FILE" ]; then had_prev=1; prev_saved="$(cat "$PREV_FILE")"; else prev_saved=""; fi

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
    use_image_sha "$image"
    compose config -q || { restore_files; log_history deploy "$tag" "$rev_before" "$rev_before" failed-config; die "compose config invalid; restored"; }

    say "migrating with $image (compose run api alembic upgrade head)"
    if ! compose run --rm --no-deps -T api alembic upgrade head; then
        restore_files
        log_history deploy "$tag" "$rev_before" "$(db_revision)" failed-migrate
        die "migration FAILED; override restored, running containers untouched. Check the schema revision before retrying."
    fi
    rev_after="$(db_revision)"
    say "schema revision after: $rev_after"

    say "recreating api worker"
    if recreate_services "$tag" && wait_healthy "$image"; then
        log_history deploy "$tag" "$rev_before" "$rev_after" ok
        say "deployed $image (previous: $IMAGE_REPO:$current, saved in $PREV_FILE)"
        return 0
    fi

    say "deploy of $image FAILED health — rolling back automatically to $IMAGE_REPO:$current"
    say "WARNING: the migration above was NOT undone; schema is at $rev_after"
    [ "$ENV_NAME" != prod ] || say "WARNING: the database was NOT restored; pre-deploy backup: ${BACKUP_FILE:-none} (sha256 ${BACKUP_SHA:-n/a})"
    cp -p "$backup" "$OVERRIDE"
    if [ "$had_prev" -eq 1 ]; then write_file_atomic "$PREV_FILE" "$prev_saved"; else rm -f "$PREV_FILE"; fi
    use_image_sha "$IMAGE_REPO:$current"
    if recreate_services "$current" && wait_healthy "$IMAGE_REPO:$current"; then
        log_history deploy "$tag" "$rev_before" "$rev_after" failed-rolled-back
        die "rolled back to $IMAGE_REPO:$current (healthy). Schema stays at $rev_after."
    fi
    log_history deploy "$tag" "$rev_before" "$rev_after" failed-rollback-unhealthy
    die "ROLLBACK ALSO UNHEALTHY — $ENV_NAME api is down. Investigate now: cd $ROOT_DIR && docker compose ps/logs (compose files: $BASE_COMPOSE + $OVERRIDE)"
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
    say "WARNING: rollback swaps the image only; database migrations are NOT undone and the database is NOT restored."
    say "         DB schema now: $schema_now; when $prev was last deployed it ran at: ${schema_then:-unknown (no history entry)}"
    [ -z "$schema_then" ] || [ "$schema_then" = "$schema_now" ] \
        || say "         schema differs: $prev must tolerate the newer schema (expand/contract rule)."
    [ "$ENV_NAME" != prod ] || confirm "rollback prod $prev"

    cp -p "$OVERRIDE" "$OVERRIDE.bak.$(date -u +%Y%m%dT%H%M%SZ)"
    set_override_tag "$prev" || die "could not rewrite override"
    # Swap, so a second --rollback undoes this one instead of pointing at itself.
    write_file_atomic "$PREV_FILE" "$current"
    use_image_sha "$image"
    say "[$ENV_NAME] rolling back: $IMAGE_REPO:$current -> $image"
    if recreate_services "$prev" && wait_healthy "$image"; then
        log_history rollback "$prev" "$schema_now" "$schema_now" ok
        say "live: $image"
        return 0
    fi
    log_history rollback "$prev" "$schema_now" "$schema_now" unhealthy
    die "rollback to $image is NOT healthy — $ENV_NAME api may be down. No further automatic action taken."
}

case "$ARG" in
    --rollback) do_rollback ;;
    -*) usage ;;
    *) do_deploy "${ARG#"$IMAGE_REPO":}" ;;
esac
