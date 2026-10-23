#!/usr/bin/env bash
# Drill for ops/deploy-api.sh against a fake docker, curl and backup script, plus a real
# throwaway git remote. Touches nothing outside a temp dir; needs neither root nor docker.
#
#   bash ops/test-deploy-api.sh
#
# The script under test is copied and its root paths, root check, health timeout and
# deploy.conf ownership check are rewritten to point at the temp dir. Everything else runs
# as written.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
FAIL=0
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t

mkdir -p "$T/bin" "$T/qa" "$T/prod" "$T/backups" "$T/labels"
sed -e "s#^QA_ROOT=.*#QA_ROOT=$T/qa#" \
    -e "s#^PROD_ROOT=.*#PROD_ROOT=$T/prod#" \
    -e 's#^\[ "\$(id -u)" -eq 0 \].*#true#' \
    -e 's#^HEALTH_TIMEOUT=60#HEALTH_TIMEOUT=4#' \
    -e "s#\"\$(stat -c '%u' \"\$conf\")\" -eq 0#\"\$(stat -c '%u' \"\$conf\")\" -eq \"\$(id -u)\"#" \
    "$HERE/deploy-api.sh" > "$T/deploy-api.sh"
grep -q "$T/qa" "$T/deploy-api.sh" || { echo "sed rewrite failed"; exit 2; }

# --- fakes ---------------------------------------------------------------------
cat > "$T/bin/docker" <<'EOF'
#!/bin/bash
T="$(cd "$(dirname "$0")/.." && pwd)"
echo "docker $*" >> "$T/calls.log"
if [ "$1 $2" = "image inspect" ]; then
  if [ "$3" = "--format" ]; then            # label lookup: docker image inspect --format T mento-api:TAG
    f="$T/labels/${5#mento-api:}"; [ -f "$f" ] && cat "$f"; exit 0
  fi
  [ "${3#mento-api:}" = ghost ] && exit 1
  exit 0
fi
ov=""; prev=""
for a in "$@"; do [ "$prev" = "-f" ] && ov="$a"; prev="$a"; done
tag() { awk '/^  api:/{f=1;next} f&&/image:/{sub(/.*mento-api:/,"");print;exit}' "$ov"; }
case "$*" in
  *"alembic current"*)      cat "$T/rev" 2>/dev/null || echo base; exit 0;;
  *"alembic upgrade head"*) [ -f "$T/migfail" ] && exit 1; echo head > "$T/rev"; exit 0;;
  *"ps -q api"*)            echo cid; exit 0;;
  "inspect --format"*)      cat "$T/running"; exit 0;;
  *" up -d"*)               echo "mento-api:$(tag)" > "$T/running"; echo "${GIT_SHA:-}" > "$T/last_git_sha"; exit 0;;
esac
exit 0
EOF
cat > "$T/bin/curl" <<'EOF'
#!/bin/bash
T="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$T/unhealthy_tag" ] && grep -q "$(cat "$T/unhealthy_tag")" "$T/running"; then echo -n 503; else echo -n 200; fi
EOF
cat > "$T/backup.sh" <<'EOF'
#!/bin/bash
T="$(cd "$(dirname "$0")" && pwd)"
echo run >> "$T/backup_runs"
[ -f "$T/backup_fail" ] && exit 1
f="$T/backups/mento-$(date +%s%N).sql.gz"
case "$(cat "$T/backup_mode" 2>/dev/null)" in
  empty)   : > "$f";;
  corrupt) echo "not gzip" > "$f";;
  none)    ;;
  *)       echo "select 1;" | gzip > "$f";;
esac
EOF
chmod +x "$T/bin/"* "$T/backup.sh"

# --- git: bare origin with main; a clone as MENTO_REPO ------------------------
git init -q --bare -b main "$T/origin.git"
git clone -q "$T/origin.git" "$T/work" 2>/dev/null
( cd "$T/work" && git checkout -q -b main && echo 1 > f && git add f && git commit -qm c1 && git push -q origin main \
  && git checkout -q -b side && echo 2 > f && git commit -qam c2 && git push -q origin side )
SHA_MAIN="$(git -C "$T/work" rev-parse main)"
SHA_SIDE="$(git -C "$T/work" rev-parse side)"
git clone -q "$T/origin.git" "$T/src" 2>/dev/null
TAG_MAIN="${SHA_MAIN:0:12}-r1"
TAG_SIDE="${SHA_SIDE:0:12}-r1"
echo "$SHA_MAIN" > "$T/labels/$TAG_MAIN"
echo "$SHA_SIDE" > "$T/labels/$TAG_SIDE"
echo "${SHA_MAIN:0:12}-r2" > /dev/null
echo "$SHA_MAIN" > "$T/labels/${SHA_MAIN:0:12}-r3"          # label ok, used for mismatch below
echo "$SHA_SIDE" > "$T/labels/${SHA_MAIN:0:12}-r9"           # tag says main commit, label says side
: > "$T/labels/${SHA_MAIN:0:12}-r7"                          # image without a revision label

# --- fixtures ------------------------------------------------------------------
reset() {
    cat > "$T/qa/ci.override.yml" <<'YML'
services:
  api:
    image: mento-api:0f1e133f175c
  worker:
    image: mento-api:0f1e133f175c
  migrate:
    image: mento-api:0f1e133f175c
YML
    touch "$T/qa/compose.yml" "$T/qa/ci.lock" "$T/prod/compose.prod-cutover.yml" "$T/prod/api.env"
    cat > "$T/prod/prod.override.yml" <<'YML'
services:
  api:
    image: mento-api:92b8f57a5cd3
  worker:
    image: mento-api:92b8f57a5cd3
YML
    printf 'PROJECT=deploy\nMENTO_ENV_FILE=%s/prod/api.env\n' "$T" > "$T/prod/deploy.conf"
    chmod 644 "$T/prod/deploy.conf"
    printf 'MENTO_REPO=%s/src\nMENTO_BACKUP_DIR=%s/backups\nMENTO_BACKUP_SCRIPT=%s/backup.sh\n' "$T" "$T" "$T" >> "$T/prod/deploy.conf"
    rm -f "$T"/qa/previous-api-tag "$T"/qa/deploy-history.log "$T"/prod/previous-api-tag "$T"/prod/deploy-history.log \
          "$T"/qa/*.bak.* "$T"/prod/*.bak.* "$T"/backups/* "$T"/backup_runs "$T"/backup_fail "$T"/backup_mode \
          "$T"/migfail "$T"/unhealthy_tag "$T"/last_git_sha "$T"/calls.log
    echo base > "$T/rev"
    echo "mento-api:92b8f57a5cd3" > "$T/running"
}
run() { # <stdin> <args...>  -> sets OUT, RC
    local input=$1; shift
    OUT="$(printf '%s\n' "$input" | PATH="$T/bin:$PATH" bash "$T/deploy-api.sh" "$@" 2>&1)"; RC=$?
}
ok() { # <name> <condition-exit-code>
    if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "  ok   $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1"; echo "$OUT" | sed 's/^/       | /'; fi
}
has() { grep -qF -- "$1" <<<"$OUT"; }
ovtag() { awk '/^  api:/{f=1;next} f&&/image:/{sub(/.*mento-api:/,"");print;exit}' "$1"; }

# docker image inspect for plain "exists" must succeed for any tag but ghost
echo "== QA (regression: behaviour of the old qa-deploy-api)"
reset
run "" qa ghost;                       ok "qa: missing image refuses"        $((RC == 1 ? 0 : 1))
run "" qa aaaa1111;                    ok "qa: deploys, no main/backup/confirm gate" $((RC == 0 ? 0 : 1))
ok "qa: override rewritten"            $([ "$(ovtag "$T/qa/ci.override.yml")" = aaaa1111 ] && echo 0 || echo 1)
ok "qa: previous tag saved"            $([ "$(cat "$T/qa/previous-api-tag")" = 0f1e133f175c ] && echo 0 || echo 1)
ok "qa: no backup taken"               $([ ! -f "$T/backup_runs" ] && echo 0 || echo 1)
run "" qa aaaa1111;                    ok "qa: same tag refused"             $((RC == 1 ? 0 : 1))
echo "unhealthy" > /dev/null; echo bbbb2222 > "$T/unhealthy_tag"
run "" qa bbbb2222;                    ok "qa: health failure rolls back, exit 1" $((RC == 1 && $(has "rolled back to mento-api:aaaa1111" && echo 0 || echo 1) == 0 ? 0 : 1))
ok "qa: override restored after auto-rollback" $([ "$(ovtag "$T/qa/ci.override.yml")" = aaaa1111 ] && echo 0 || echo 1)
rm -f "$T/unhealthy_tag"; touch "$T/migfail"
run "" qa cccc3333;                    ok "qa: migration failure keeps override" $((RC == 1 && $([ "$(ovtag "$T/qa/ci.override.yml")" = aaaa1111 ] && echo 0 || echo 1) == 0 ? 0 : 1))
rm -f "$T/migfail"
run "" qa --rollback;                  ok "qa: --rollback restores previous tag" $((RC == 0 && $([ "$(ovtag "$T/qa/ci.override.yml")" = 0f1e133f175c ] && echo 0 || echo 1) == 0 ? 0 : 1))
ok "qa: rollback warns migrations not undone" $(has "NOT undone" && echo 0 || echo 1)
ok "qa: history has env=qa"            $(grep -q "env=qa action=deploy tag=aaaa1111 .* result=ok" "$T/qa/deploy-history.log" && echo 0 || echo 1)

echo "== prod gates (nothing may change when a gate fails)"
reset
snap() { cat "$T/prod/prod.override.yml"; }
BEFORE="$(snap)"
unchanged() { [ "$(snap)" = "$BEFORE" ] && [ ! -f "$T/prod/previous-api-tag" ] && [ ! -f "$T/backup_runs" ]; }
mv "$T/prod/deploy.conf" "$T/dc"; run "" prod "$TAG_MAIN"; ok "prod: missing deploy.conf refused" $((RC == 1 ? 0 : 1)); mv "$T/dc" "$T/prod/deploy.conf"
chmod 666 "$T/prod/deploy.conf"; run "" prod "$TAG_MAIN"; ok "prod: group/world-writable deploy.conf refused" $((RC == 1 && $(has "writable" && echo 0 || echo 1) == 0 ? 0 : 1)); chmod 644 "$T/prod/deploy.conf"
run "deploy prod abc" prod aaaa1111;   ok "prod: tag must be <sha12>-r<N>"   $((RC == 1 && $(has "prod tags must look like" && echo 0 || echo 1) == 0 ? 0 : 1))
run "" prod "${SHA_MAIN:0:12}-r7";     ok "prod: image without revision label refused" $((RC == 1 && $(has "no org.opencontainers.image.revision label" && echo 0 || echo 1) == 0 ? 0 : 1))
run "" prod "${SHA_MAIN:0:12}-r9";     ok "prod: tag/label mismatch refused" $((RC == 1 && $(has "does not match" && echo 0 || echo 1) == 0 ? 0 : 1))
run "" prod "$TAG_SIDE";               ok "prod: commit not on origin/main refused" $((RC == 1 && $(has "NOT on origin/main" && echo 0 || echo 1) == 0 ? 0 : 1))
run "wrong phrase" prod "$TAG_MAIN";   ok "prod: wrong confirmation changes nothing" $((RC == 1 && $(has "confirmation mismatch" && echo 0 || echo 1) == 0 ? 0 : 1))
ok "prod: gate failures left override/backup/previous-tag untouched" $(unchanged && echo 0 || echo 1)
touch "$T/backup_fail"
run "deploy prod $TAG_MAIN" prod "$TAG_MAIN"; ok "prod: backup failure aborts before any change" $((RC == 1 && $(has "backup FAILED" && echo 0 || echo 1) == 0 ? 0 : 1))
ok "prod: override unchanged after backup failure" $([ "$(snap)" = "$BEFORE" ] && [ ! -f "$T/prod/previous-api-tag" ] && echo 0 || echo 1)
rm -f "$T/backup_fail"
for mode in empty corrupt none; do
    echo "$mode" > "$T/backup_mode"; rm -f "$T"/backups/*
    run "deploy prod $TAG_MAIN" prod "$TAG_MAIN"
    ok "prod: $mode backup refused, override unchanged" $((RC == 1 && $([ "$(snap)" = "$BEFORE" ] && echo 0 || echo 1) == 0 ? 0 : 1))
done
rm -f "$T/backup_mode"

echo "== prod deploy, health failure, rollback"
reset
run "deploy prod $TAG_MAIN" prod "$TAG_MAIN"
ok "prod: deploy succeeds"             $((RC == 0 ? 0 : 1))
ok "prod: override rewritten"          $([ "$(ovtag "$T/prod/prod.override.yml")" = "$TAG_MAIN" ] && echo 0 || echo 1)
ok "prod: previous tag saved"          $([ "$(cat "$T/prod/previous-api-tag")" = 92b8f57a5cd3 ] && echo 0 || echo 1)
ok "prod: backup taken in this run (script ran once)" $([ "$(wc -l < "$T/backup_runs")" -eq 1 ] && echo 0 || echo 1)
ok "prod: backup sha256 printed"       $(has "backup sha256:" && echo 0 || echo 1)
ok "prod: history records backup + sha256" $(grep -qE "env=prod action=deploy tag=$TAG_MAIN .* result=ok backup=mento-[0-9]+\.sql\.gz sha256=[0-9a-f]{64}" "$T/prod/deploy-history.log" && echo 0 || echo 1)
ok "prod: GIT_SHA exported to compose (Sentry release)" $([ "$(cat "$T/last_git_sha")" = "$SHA_MAIN" ] && echo 0 || echo 1)
ok "prod: compose got -p project and --env-file" $(grep -q -- "-p deploy --env-file $T/prod/api.env" "$T/calls.log" && echo 0 || echo 1)
ok "prod: never down/volume commands"  $(! grep -qE "down|volume" "$T/calls.log" && echo 0 || echo 1)
run "" prod "$TAG_MAIN";               ok "prod: same tag refused" $((RC == 1 ? 0 : 1))

echo "${SHA_MAIN:0:12}-r4" > /dev/null
echo "$SHA_MAIN" > "$T/labels/${SHA_MAIN:0:12}-r4"
echo "${SHA_MAIN:0:12}-r4" > "$T/unhealthy_tag"
run "deploy prod ${SHA_MAIN:0:12}-r4" prod "${SHA_MAIN:0:12}-r4"
ok "prod: health failure rolls back automatically, exit 1" $((RC == 1 && $(has "rolled back to mento-api:$TAG_MAIN" && echo 0 || echo 1) == 0 ? 0 : 1))
ok "prod: auto-rollback warns database NOT restored and names the backup" $(has "database was NOT restored" && has "sha256" && echo 0 || echo 1)
ok "prod: override back on previous good tag" $([ "$(ovtag "$T/prod/prod.override.yml")" = "$TAG_MAIN" ] && echo 0 || echo 1)
rm -f "$T/unhealthy_tag"
run "wrong" prod --rollback;           ok "prod: --rollback needs confirmation" $((RC == 1 && $(has "confirmation mismatch" && echo 0 || echo 1) == 0 ? 0 : 1))
run "rollback prod 92b8f57a5cd3" prod --rollback
ok "prod: --rollback restores the old image" $((RC == 0 && $([ "$(ovtag "$T/prod/prod.override.yml")" = 92b8f57a5cd3 ] && echo 0 || echo 1) == 0 ? 0 : 1))
ok "prod: rollback says DB is not restored" $(has "database is NOT restored" && echo 0 || echo 1)

echo "== prod: rollback onto an image that predates the worker"
reset
printf 'NO_WORKER_TAGS="92b8f57a5cd3"\n' >> "$T/prod/deploy.conf"
run "deploy prod $TAG_MAIN" prod "$TAG_MAIN"
: > "$T/calls.log"
run "rollback prod 92b8f57a5cd3" prod --rollback
ok "prod: rollback to no-worker image succeeds" $((RC == 0 ? 0 : 1))
ok "prod: starts api only and stops the worker" $(grep -q " up -d --no-deps api\$" "$T/calls.log" && grep -q " stop worker" "$T/calls.log" && ! grep -q "up -d --no-deps api worker" "$T/calls.log" && echo 0 || echo 1)
ok "prod: deploying a normal tag still starts api+worker" $(run "deploy prod $TAG_MAIN" prod "$TAG_MAIN"; grep -q "up -d --no-deps api worker" "$T/calls.log" && echo 0 || echo 1)

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
