#!/usr/bin/env bash
# Release a commit from main to PRODUCTION on this box (api.mento.chat, app.mento.chat,
# admin.mento.chat). Founder rule: production deploys only commits on origin/main, and
# only when the founder asks. Runbook: docs/PRODUCTION.md.
#
#   sudo ops/prod-release.sh <sha> --yes-production       build, back up, migrate, deploy API, then web
#   sudo ops/prod-release.sh --rollback --yes-production   previous API image AND previous web release
#   ops/prod-release.sh <sha> --dry-run                    run every guard and print the plan; change nothing
#   ops/prod-release.sh --status                           what is live, last releases, health
#
# Refuses unless: <sha> is on origin/main; ops/ci.sh recorded a pass for it
# (/srv/mento/logs/ci/<sha>.log); the required secret NAMES are set in
# /opt/mento-prod/secrets/api.env (values are never read into output).
#
# Order (a failure stops at the first step and changes nothing after it):
#   guards -> build web export (as the repo owner) -> build API image mento-api:prod-<sha12>-r<N>
#   -> encrypted pre-deploy DB dump (failure aborts) -> migrate with the new image
#   -> recreate api + worker -> wait for 127.0.0.1:18110/api/v1/health/ready on the new image
#      (unhealthy -> automatic rollback to the previous image)
#   -> install the web release (atomic symlink swap, previous kept).
# Rollback swaps images and the web symlink only; migrations are never undone (expand/contract).
# Every action is appended to /opt/mento-prod/release-history.log with who ran it.
set -euo pipefail

REPO=${PROD_REPO:-/srv/mento/mento-app}
ROOT_DIR=${PROD_ROOT:-/opt/mento-prod}
COMPOSE_FILE=$ROOT_DIR/compose.yml
RELEASE_ENV=$ROOT_DIR/release.env
PREV_FILE=$ROOT_DIR/previous-release.env
HISTORY=$ROOT_DIR/release-history.log
LOCK=$ROOT_DIR/release.lock
API_ENV=$ROOT_DIR/secrets/api.env
WEB_RELEASES=$ROOT_DIR/web-releases
WEB_LINK=$ROOT_DIR/web
PREV_WEB=$ROOT_DIR/previous-web
BACKUP_DIR=${PROD_PREDEPLOY_DIR:-/opt/mento-backups/prod-predeploy}
RECIPIENTS=${PROD_AGE_RECIPIENTS:-/etc/mento/age/prod.recipients}
CI_LOG_DIR=${PROD_CI_LOG_DIR:-/srv/mento/logs/ci}
HEALTH_URL=http://127.0.0.1:18110/api/v1/health/ready
HEALTH_TIMEOUT=90
WEB_BUILD_ROOT=${PROD_WEB_BUILD_ROOT:-/srv/mento/build}
# Names (never values) the API refuses to run safely without (app/main.py invariants + own chat).
REQUIRED_NAMES=(DATABASE_URL JWT_SECRET ADMIN_JWT_SECRET LISTENER_JWT_SECRET MESSAGE_KEY
                STREAM_API_KEY STREAM_API_SECRET)

# shellcheck source=lib/prod-guards.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/prod-guards.sh"

die() { echo "prod-release: $*" >&2; exit 1; }
say() { echo "prod-release: $*"; }
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
usage() { sed -n '6,10p' "$0" >&2; exit 2; }

MODE="" SHA="" YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --yes-production) YES=1 ;;
    --dry-run) MODE=dry ;;
    --rollback) MODE=rollback ;;
    --status) MODE=status ;;
    -h|--help) usage ;;
    -*) die "unknown option $1" ;;
    *) [ -z "$SHA" ] || usage; SHA=$1 ;;
  esac
  shift
done
[ -n "$MODE" ] || MODE=deploy
case $MODE in
  deploy)   [ -n "$SHA" ] || usage
            [ "$YES" = 1 ] || die "this deploys to PRODUCTION; add --yes-production (or use --dry-run)" ;;
  rollback) [ -z "$SHA" ] || usage
            [ "$YES" = 1 ] || die "this rolls back PRODUCTION; add --yes-production" ;;
  dry)      [ -n "$SHA" ] || usage ;;
  status)   [ -z "$SHA" ] || usage ;;
esac
if [ "$MODE" = deploy ] || [ "$MODE" = rollback ]; then
  [ "$(id -u)" -eq 0 ] || die "must run as root (sudo)"
fi

compose() { docker compose -p mento-prod -f "$COMPOSE_FILE" --env-file "$RELEASE_ENV" "$@"; }
kv() { if [ -f "$1" ]; then sed -n "s/^$2=//p" "$1" | tail -1; fi; }
log_history() { # key=value pairs
  printf '%s by=%s %s\n' "$(now)" "${SUDO_USER:-$(id -un)}" "$*" >> "$HISTORY"
}

# Names only: report which required settings are empty, never their values.
secrets_ok() {
  local missing=() n
  [ -r "$API_ENV" ] || { echo "prod-release: cannot read $API_ENV (run infra/prod-root-setup.sh)" >&2; return 1; }
  for n in "${REQUIRED_NAMES[@]}"; do
    grep -qE "^${n}=.+" "$API_ENV" || missing+=("$n")
  done
  [ ! -s "$ROOT_DIR/secrets/files/fcm.json" ] && say "WARNING: no FCM service account (secrets/files/fcm.json): push stays off"
  if [ ${#missing[@]} -gt 0 ]; then
    echo "prod-release: required settings not set in $API_ENV: ${missing[*]}" >&2
    return 1
  fi
}

guards() { # sets FULL
  FULL=$(prod_on_main "$REPO" "$SHA") || exit 1
  prod_ci_passed "$CI_LOG_DIR" "$FULL" || exit 1
  say "on origin/main and ops/ci passed: $FULL"
}

wait_healthy() { # <image>
  local want=$1 deadline=$((SECONDS + HEALTH_TIMEOUT)) code="" cid img=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    cid=$(compose ps -q api 2>/dev/null || true)
    img=""; [ -z "$cid" ] || img=$(docker inspect --format '{{.Config.Image}}' "$cid" 2>/dev/null || true)
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null || true)
    if [ "$code" = 200 ] && [ "$img" = "$want" ]; then say "healthy on $img"; return 0; fi
    sleep 2
  done
  say "NOT healthy after ${HEALTH_TIMEOUT}s (http=${code:-none}, running=${img:-none}, want=$want)"
  return 1
}

db_revision() {
  local out
  out=$(compose run --rm --no-deps -T migrate alembic current 2>/dev/null | awk 'NF {print $1}' | tail -n 1) || true
  echo "${out:-unknown}"
}

write_release_env() { # <tag> <full sha>
  local tmp=$RELEASE_ENV.tmp.$$
  printf 'MENTO_API_TAG=%s\nMENTO_GIT_SHA=%s\n' "$1" "$2" > "$tmp"
  chmod 644 "$tmp"; mv -f "$tmp" "$RELEASE_ENV"
}

swap_symlink() { local tmp=$1.tmp.$$; ln -sfn "$2" "$tmp"; mv -T "$tmp" "$1"; }

# Encrypted dump before any migration. No database yet (first release) = nothing to lose.
predeploy_dump() { # <tag>
  local out
  if [ -z "$(compose ps -q postgres 2>/dev/null)" ]; then
    say "no running prod database yet (first release): no pre-deploy dump needed"; return 0
  fi
  [ -s "$RECIPIENTS" ] || die "no age recipients at $RECIPIENTS; nothing was changed"
  install -d -m 700 "$BACKUP_DIR"
  out="$BACKUP_DIR/predeploy-$1-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.age"
  if ! ( set -o pipefail; umask 077
         compose exec -T postgres pg_dump -U mento -d mento | gzip \
           | age --encrypt --recipients-file "$RECIPIENTS" --output "$out" ) || [ ! -s "$out" ]; then
    rm -f "$out"; die "pre-deploy database dump FAILED; nothing was changed"
  fi
  say "database dumped (encrypted): $out"
}

# Web export as the repo owner in a throwaway worktree; prints the export dir.
build_web() { # <full sha>
  local full=$1 owner wt
  owner=$(stat -c %U "$REPO")
  wt=$WEB_BUILD_ROOT/prod-web-${full:0:12}
  sudo -u "$owner" -H bash -euo pipefail -c '
    repo=$1 full=$2 wt=$3
    git -C "$repo" worktree remove --force "$wt" >/dev/null 2>&1 || rm -rf "$wt"
    git -C "$repo" worktree add -q --detach "$wt" "$full"
    cd "$wt/apps/mobile"
    # Build settings from the release commit itself, not from the checkout (no apostrophes in this block).
    . "$wt/ops/lib/build-env.sh"
    mento_build_env prod "${full:0:7}"
    env -u NODE_ENV npm ci --no-audit --no-fund >/dev/null
    NODE_ENV=production npx expo export --platform web --output-dir dist-prod >/dev/null
    [ -f dist-prod/index.html ] || { echo "web export produced no index.html" >&2; exit 7; }
  ' _ "$REPO" "$full" "$wt" >&2 || die "web build failed (nothing deployed)"
  echo "$wt/apps/mobile/dist-prod"
}

install_web() { # <export dir> <full sha>
  local src=$1 full=$2 name current
  name="web-${full:0:12}-$(date -u +%Y%m%dT%H%M%SZ)"
  install -d -m 755 "$WEB_RELEASES"
  cp -r "$src" "$WEB_RELEASES/.$name.tmp"
  chown -R root:root "$WEB_RELEASES/.$name.tmp"; chmod -R a+rX,go-w "$WEB_RELEASES/.$name.tmp"
  mv "$WEB_RELEASES/.$name.tmp" "$WEB_RELEASES/$name"
  current=$(readlink -f "$WEB_LINK" 2>/dev/null || true)
  swap_symlink "$WEB_LINK" "$WEB_RELEASES/$name"
  [ -z "$current" ] || [ ! -d "$current" ] || swap_symlink "$PREV_WEB" "$current"
  say "web live: $name"
  # Keep the five newest releases plus whatever is live or previous.
  local keep_live keep_prev
  keep_live=$(readlink -f "$WEB_LINK"); keep_prev=$(readlink -f "$PREV_WEB" 2>/dev/null || true)
  find "$WEB_RELEASES" -mindepth 1 -maxdepth 1 -type d -name 'web-*' -printf '%T@ %p\n' | sort -rn \
    | tail -n +6 | cut -d' ' -f2- | while read -r d; do
        [ "$d" = "$keep_live" ] || [ "$d" = "$keep_prev" ] || rm -rf -- "$d"
      done
}

build_api() { # <full sha>; prints the new tag
  local full=$1 owner out tag
  owner=$(stat -c %U "$REPO")
  out=$(sudo -u "$owner" -H env BUILD_TAG_PREFIX=prod- "$REPO/ops/build-api.sh" "$full" | bash 2>&1) \
    || { printf '%s\n' "$out" | tail -20 >&2; die "API image build failed (nothing deployed)"; }
  tag=$(printf '%s\n' "$out" | sed -n 's/^built mento-api:\([^;]*\);.*/\1/p' | tail -1)
  [[ $tag =~ ^prod-[0-9a-f]{12}-r[0-9]+$ ]] || die "could not read the built tag"
  echo "$tag"
}

do_status() {
  echo "live:     $(kv "$RELEASE_ENV" MENTO_API_TAG) (commit $(kv "$RELEASE_ENV" MENTO_GIT_SHA))"
  echo "previous: $(kv "$PREV_FILE" MENTO_API_TAG)"
  echo "web:      $(readlink "$WEB_LINK" 2>/dev/null || echo none)"
  echo "prev web: $(readlink "$PREV_WEB" 2>/dev/null || echo none)"
  printf 'health:   %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" || echo down)"
  [ -f "$HISTORY" ] && { echo "last releases:"; tail -n 5 "$HISTORY" | sed 's/^/  /'; }
  return 0
}

do_dry() {
  guards
  secrets_ok || say "(dry run) secrets would block the deploy"
  say "(dry run) would: build web for ${FULL:0:12}; build mento-api:prod-${FULL:0:12}-r<N>;"
  say "  encrypted pre-deploy dump; migrate; recreate api+worker; health $HEALTH_URL; install web."
  say "  live now: $(kv "$RELEASE_ENV" MENTO_API_TAG) — nothing was changed"
}

do_deploy() {
  local tag image cur_tag cur_sha web rev_before rev_after
  exec 9>>"$LOCK"; flock -n 9 || die "another release holds $LOCK"
  [ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE (run infra/prod-root-setup.sh)"
  guards
  secrets_ok || die "fix the settings above, then re-run"
  cur_tag=$(kv "$RELEASE_ENV" MENTO_API_TAG); cur_sha=$(kv "$RELEASE_ENV" MENTO_GIT_SHA)
  [ "$cur_sha" != "$FULL" ] || die "$FULL is already live (tag $cur_tag)"

  say "building web export for ${FULL:0:12}"
  web=$(build_web "$FULL")
  say "building API image"
  tag=$(build_api "$FULL"); image=mento-api:$tag
  say "built $image"

  [ -f "$RELEASE_ENV" ] && cp -p "$RELEASE_ENV" "$PREV_FILE.next"
  predeploy_dump "$tag"
  write_release_env "$tag" "$FULL"
  # First release: the database initialises here; --wait holds until both are healthy.
  compose up -d --wait postgres valkey >/dev/null || die "postgres/valkey did not become healthy (nothing deployed)"
  rev_before=$(db_revision)
  say "migrating (schema before: $rev_before)"
  if ! compose run --rm --no-deps -T migrate; then
    if [ -f "$PREV_FILE.next" ]; then mv -f "$PREV_FILE.next" "$RELEASE_ENV"; else rm -f "$RELEASE_ENV"; fi
    log_history action=deploy commit="$FULL" tag="$tag" rev_before="$rev_before" result=failed-migrate
    die "migration FAILED; release.env restored, running containers untouched"
  fi
  rev_after=$(db_revision)
  say "recreating api + worker on $image (schema now: $rev_after)"
  if compose up -d --no-deps api worker && wait_healthy "$image"; then
    [ -f "$PREV_FILE.next" ] && mv -f "$PREV_FILE.next" "$PREV_FILE"
    install_web "$web" "$FULL"
    log_history action=deploy commit="$FULL" tag="$tag" rev_before="$rev_before" rev_after="$rev_after" \
      web="$(basename "$(readlink "$WEB_LINK")")" result=ok
    say "RELEASED $FULL ($image). Rollback: sudo ops/prod-release.sh --rollback --yes-production"
    return 0
  fi
  say "unhealthy: rolling back to ${cur_tag:-nothing} (migration stays at $rev_after)"
  if [ -f "$PREV_FILE.next" ]; then
    mv -f "$PREV_FILE.next" "$RELEASE_ENV"
    if compose up -d --no-deps api worker && wait_healthy "mento-api:$cur_tag"; then
      log_history action=deploy commit="$FULL" tag="$tag" rev_after="$rev_after" result=failed-rolled-back
      die "rolled back to mento-api:$cur_tag (healthy); web unchanged"
    fi
    log_history action=deploy commit="$FULL" tag="$tag" result=failed-rollback-unhealthy
    die "ROLLBACK ALSO UNHEALTHY: production API is down. compose: docker compose -p mento-prod ps/logs"
  fi
  log_history action=deploy commit="$FULL" tag="$tag" result=failed-first-release
  die "first release is unhealthy; inspect: docker compose -p mento-prod -f $COMPOSE_FILE --env-file $RELEASE_ENV logs api"
}

do_rollback() {
  local cur prev_tag prev_sha web_prev cur_web
  exec 9>>"$LOCK"; flock -n 9 || die "another release holds $LOCK"
  [ -f "$PREV_FILE" ] || die "no previous release recorded ($PREV_FILE)"
  prev_tag=$(kv "$PREV_FILE" MENTO_API_TAG); prev_sha=$(kv "$PREV_FILE" MENTO_GIT_SHA)
  docker image inspect "mento-api:$prev_tag" >/dev/null 2>&1 || die "image mento-api:$prev_tag is gone"
  cur=$RELEASE_ENV.rollback.$$; cp -p "$RELEASE_ENV" "$cur"
  say "WARNING: images and web only; migrations are NOT undone (schema now: $(db_revision))"
  cp -p "$PREV_FILE" "$RELEASE_ENV"
  if compose up -d --no-deps api worker && wait_healthy "mento-api:$prev_tag"; then
    mv -f "$cur" "$PREV_FILE"   # swap, so a second rollback undoes this one
  else
    cp -p "$cur" "$RELEASE_ENV"; rm -f "$cur"
    compose up -d --no-deps api worker || true
    log_history action=rollback tag="$prev_tag" result=unhealthy-restored
    die "previous image unhealthy; restored the current one"
  fi
  if [ -L "$PREV_WEB" ]; then
    web_prev=$(readlink -f "$PREV_WEB"); cur_web=$(readlink -f "$WEB_LINK")
    swap_symlink "$WEB_LINK" "$web_prev"; swap_symlink "$PREV_WEB" "$cur_web"
  fi
  log_history action=rollback commit="$prev_sha" tag="$prev_tag" web="$(basename "$(readlink "$WEB_LINK" 2>/dev/null || echo none)")" result=ok
  say "rolled back to mento-api:$prev_tag (commit $prev_sha) and web $(readlink "$WEB_LINK" 2>/dev/null || echo unchanged)"
}

case $MODE in
  status)   do_status ;;
  dry)      do_dry ;;
  deploy)   do_deploy ;;
  rollback) do_rollback ;;
esac
