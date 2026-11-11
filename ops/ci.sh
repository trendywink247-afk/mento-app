#!/usr/bin/env bash
# Local CI: every check that gates a PR, run on this box against one commit. There is no GitHub
# Actions; this script (driven by ops/ci-poll.sh) is the CI. It posts the result as a GitHub
# commit status named "ops/ci" (a record on the commit, nothing runs on GitHub).
#
#   ops/ci.sh [--quick|--full] <sha>
#
#   (default)  everything that gates a PR: API lint, migrations + pytest + OpenAPI compat on a
#              private database, recovery receiver, release-tooling unit tests, shell syntax and
#              ShellCheck errors, mobile typecheck + all unit tests, Docker drills when Docker works.
#   --quick    lint + typecheck + unit tests only (no database, no drills, no status post).
#   --full     default + the browser tier: web export and the age-gate browser test.
#
# - Checks <sha> out in a throwaway worktree under /srv/mento/ci-work/ and removes it on exit.
# - Log: /srv/mento/logs/ci/<full-sha>.log (one section per tier, then a timed summary).
# - Tiers run in parallel. The database tier uses its own throwaway database
#   (mento_ci_<sha12>_<pid>, plus one per pytest worker) on the local test Postgres, and a Redis
#   db index of its own, so it never collides with the shared `mento` database other sessions use
#   under /srv/mento/locks/testdb.lock. One CI database tier runs at a time (ci-db.lock) to keep
#   Postgres connections in budget. The database URL is forced to 127.0.0.1: the suite TRUNCATEs.
# - Caches (/srv/mento/ci-cache): API and receiver venvs keyed by requirements hash; mobile
#   node_modules keyed by package-lock hash, hard-linked into each worktree with the cached files
#   made read-only, so a tool that tried to edit one in place fails loudly instead of poisoning it.
# - OPS_CI_NO_POST=1 runs without posting a status. --quick never posts.
# - Exit: 0 all passed; 1 a check failed; 2 usage/setup error; 3 status post failed (not 403);
#   4 a run for the same commit is already in progress.
# Functions run via traps and background tiers, which ShellCheck cannot follow.
# shellcheck disable=SC2317,SC2016
set -uo pipefail

ROOT=/srv/mento
LOG_DIR="$ROOT/logs/ci"
LOCK_DIR="$ROOT/locks"
WORK_DIR="$ROOT/ci-work"
CACHE_DIR="$ROOT/ci-cache"
CONTEXT="ops/ci"
PG_ADMIN="postgresql://mento:mento@127.0.0.1:5432/postgres"
XDIST_PIN="pytest-xdist==3.6.1"
PYTEST_WORKERS="${OPS_CI_PYTEST_WORKERS:-4}"

die() { echo "ops/ci: $*" >&2; exit 2; }

TIER='pr'
case "${1:-}" in
    --quick) TIER=quick; shift ;;
    --full) TIER=full; shift ;;
esac
[ $# -eq 1 ] || die "usage: ops/ci.sh [--quick|--full] <sha>"
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || die "not in a git repo"
SHA="$(git -C "$REPO" rev-parse --verify --quiet "$1^{commit}")" || die "unknown commit: $1"
# shellcheck source=ops/lib/ci-tools.sh
. "$REPO/ops/lib/ci-tools.sh"

mkdir -p "$LOG_DIR" "$LOCK_DIR" "$WORK_DIR" "$CACHE_DIR"
exec 7>"$LOCK_DIR/ci-$SHA.lock"
flock --nonblock 7 || { echo "ops/ci: a run for $SHA is already in progress" >&2; exit 4; }
LOG="$LOG_DIR/$SHA.log"
[ "$TIER" = quick ] && LOG="$LOG_DIR/$SHA.quick.log"
: > "$LOG"
RUN="$(mktemp -d)"
WT="$WORK_DIR/$SHA-$$"
CI_DB="mento_ci_${SHA:0:12}_$$"

drop_ci_dbs() {
    psql -q "$PG_ADMIN" -Atc "SELECT datname FROM pg_database WHERE datname LIKE '${CI_DB}%'" 2>/dev/null \
        | while read -r db; do psql -q "$PG_ADMIN" -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE)" >/dev/null 2>&1; done
}
cleanup() {
    jobs -p | xargs -r kill 2>/dev/null
    drop_ci_dbs
    git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
    git -C "$REPO" worktree prune
    rm -rf "$RUN"
}
trap cleanup EXIT

say() { echo "ops/ci: $*" | tee -a "$LOG"; }

# Per-tier logging. A tier runs in its own subshell with TIER_NAME set; step/skip append to
# $RUN/<tier>.log and $RUN/<tier>.sum ("PASS|FAIL|SKIP <secs> <name> :: <last line>").
step() {
    local name=$1 rc t0 t1 out="$RUN/$TIER_NAME.out"
    shift
    t0=$(date +%s%N)
    echo "=== $name" >>"$RUN/$TIER_NAME.log"
    "$@" >"$out" 2>&1
    rc=$?
    t1=$(date +%s%N)
    cat "$out" >>"$RUN/$TIER_NAME.log"
    printf '%s %6.1fs  %-34s :: %s\n' "$([ "$rc" -eq 0 ] && echo PASS || echo FAIL)" \
        "$(( (t1 - t0) / 1000000 ))e-3" "$name" "$(tail -n 1 "$out" | cut -c1-120)" >>"$RUN/$TIER_NAME.sum"
    return "$rc"
}
skip() { printf 'SKIP %6.1fs  %-34s :: %s\n' 0 "$1" "$2" >>"$RUN/$TIER_NAME.sum"; }

# cached_venv <key-files...> -- <pip args>: print a venv path keyed by the files' hash plus args.
cached_venv() {
    local files=() key venv
    while [ "$1" != "--" ]; do files+=("$1"); shift; done; shift
    key="$( { cat "${files[@]}"; echo "$*"; } | sha256sum | cut -c1-16)"
    venv="$CACHE_DIR/venv-$key"
    if [ ! -x "$venv/bin/python" ]; then
        { python3.12 -m venv "$venv" && "$venv/bin/pip" install --quiet "$@"; } >&2 || { rm -rf "$venv"; return 1; }
    fi
    echo "$venv"
}

say "commit $SHA (tier: $TIER)"
T_START=$(date +%s)
git -C "$REPO" worktree add --detach "$WT" "$SHA" >>"$LOG" 2>&1 || die "worktree add failed (see $LOG)"
API="$WT/services/api"
RECV="$WT/services/recovery_receiver"
MOBILE="$WT/apps/mobile"

# Venvs are built up front (serially, cached) so parallel tiers never race on the same cache dir.
API_VENV="$(cached_venv "$API/requirements.txt" "$API/requirements-dev.txt" -- -r "$API/requirements-dev.txt" "$XDIST_PIN" 2>>"$LOG")" \
    || die "API venv build failed (see $LOG)"
RECV_VENV="$(cached_venv "$RECV/requirements.txt" "$RECV/requirements-dev.txt" -- -r "$RECV/requirements-dev.txt" 2>>"$LOG")" \
    || die "receiver venv build failed (see $LOG)"

# ---------------------------------------------------------------- tiers ----------------------
tier_api_lint() {
    cd "$API" || return
    step "api ruff" "$API_VENV/bin/python" -m ruff check .
    step "api black --check" "$API_VENV/bin/python" -m black --check .
}

tier_api_db() {
    cd "$API" || return
    export DATABASE_URL="postgresql+psycopg://mento:mento@127.0.0.1:5432/$CI_DB"
    # Redis db 8-15 by commit, away from db 0 (shared) and 1 (local test mode).
    export REDIS_URL="redis://127.0.0.1:6379/$((8 + 0x${SHA:0:2} % 8))"
    export JWT_SECRET="ci-secret-at-least-32-bytes-long-000000" ENV=dev
    unset PYTEST_XDIST_WORKER
    exec 9>"$LOCK_DIR/ci-db.lock"
    flock 9
    step "create private database" psql -q "$PG_ADMIN" -c "CREATE DATABASE \"$CI_DB\"" || return
    step "alembic upgrade head" "$API_VENV/bin/python" -m alembic upgrade head
    step "alembic check" "$API_VENV/bin/python" -m alembic check
    step "pytest (-n $PYTEST_WORKERS)" "$API_VENV/bin/python" -m pytest -q -p no:cacheprovider -n "$PYTEST_WORKERS"
    step "openapi_compat check" bash -c 'cd "$1" && "$2" scripts/ci/openapi_compat.py check' _ "$WT" "$API_VENV/bin/python"
    drop_ci_dbs
}

tier_receiver() {
    cd "$WT" || return
    step "receiver ruff" "$RECV_VENV/bin/python" -m ruff check services/recovery_receiver
    step "receiver ruff format" "$RECV_VENV/bin/python" -m ruff format --check services/recovery_receiver
    [ "$TIER" = quick ] && return
    step "receiver pytest" "$RECV_VENV/bin/python" -m pytest -q -p no:cacheprovider \
        -c services/recovery_receiver/pyproject.toml services/recovery_receiver/tests
    step "receipt evidence unittests" "$RECV_VENV/bin/python" -m unittest discover -s scripts -p test_recovery_receipt_evidence.py
}

tier_tooling() {
    cd "$WT" || return
    local sc f files=()
    while IFS= read -r -d '' f; do files+=("$f"); done \
        < <(find deploy scripts ops infra -name '*.sh' -not -path '*/node_modules/*' -print0 | sort -z)
    step "bash -n (${#files[@]} scripts)" bash -c 'for f; do bash -n "$f" || exit 1; done' _ "${files[@]}"
    if sc="$(tool_path shellcheck 2>>"$RUN/$TIER_NAME.log")"; then
        step "shellcheck -S error" "$sc" -S error -x "${files[@]}"
    else
        skip "shellcheck -S error" "could not install pinned shellcheck"
    fi
    [ "$TIER" = quick ] && return
    step "scripts/ci unittests" python3 -m unittest discover -s scripts/ci -p 'test_*.py'
    step "verify_safety unittests" python3 -m unittest discover -s scripts -p test_verify_safety.py
    if docker_usable; then
        local d
        for d in test-parity test-worker-rollback test-backup-failures test-monitor-alert-retry \
                 test-backup-encryption test-snapshot-ddl test-erasure-receipt-export; do
            step "drill $d" bash "deploy/$d.sh"
        done
    else
        skip "deploy drills (7)" "docker not usable by $(id -un); ops/release-drills.sh prints the root command"
    fi
}

tier_mobile() {
    cd "$MOBILE" || return
    local key nm t
    key="$(sha256sum package-lock.json | cut -c1-16)"
    nm="$CACHE_DIR/node_modules-$key"
    if [ ! -d "$nm" ]; then
        step "npm ci (cache miss)" env SKIP_SKIA_DOWNLOAD=1 npm ci --no-audit --no-fund || return
        # Freeze a copy: hard links, files read-only, published by an atomic rename.
        if ! { cp -al node_modules "$nm.tmp.$$" && find "$nm.tmp.$$" -type f -exec chmod a-w {} + \
                && mv -T "$nm.tmp.$$" "$nm"; } 2>/dev/null; then
            rm -rf "$nm.tmp.$$"
        fi
    else
        step "node_modules from cache" cp -al "$nm" node_modules || return
    fi
    step "typecheck" npm run -s typecheck
    for t in route question placement bubble; do step "test:$t" npm run -s "test:$t"; done
    step "node --test e2e/*.test.cjs" bash -c 'set -o pipefail; node --test e2e/*.test.cjs 2>&1 | tail -n 9'
}

tier_browser() {
    cd "$MOBILE" || return
    while [ ! -f "$RUN/mobile.done" ]; do sleep 2; done
    [ -d node_modules/.bin ] || { skip "browser tier" "mobile tier did not produce node_modules"; return; }
    local np pid
    export EXPO_NO_DOTENV=1 EXPO_PUBLIC_API_URL=http://127.0.0.1:18000/api/v1
    step "expo export web" npx expo export --platform web --output-dir dist-ci || return
    if ! np="$(browser_tools 2>>"$RUN/$TIER_NAME.log")"; then
        skip "age-gate browser e2e" "could not install pinned Playwright/Chromium"; return
    fi
    python3 -m http.server 18091 --bind 127.0.0.1 --directory dist-ci >/dev/null 2>&1 &
    pid=$!
    for _ in $(seq 30); do curl -fsS http://127.0.0.1:18091/ >/dev/null 2>&1 && break; sleep 1; done
    step "age-gate browser e2e" env NODE_PATH="$np" MENTO_WEB=http://127.0.0.1:18091 node e2e/age-gate.e2e.js
    kill "$pid" 2>/dev/null
    skip "own-chat browser e2e" "needs the docker workspace stack (deploy/compose.workspace.yml)"
}

run_tier() { # run_tier <name> <fn>: background a tier, logging to $RUN/<name>.*
    ( TIER_NAME=$1; : >"$RUN/$1.sum"; "$2"; touch "$RUN/$1.done" ) &
}

run_tier api-lint tier_api_lint
run_tier receiver tier_receiver
run_tier tooling tier_tooling
run_tier mobile tier_mobile
if [ "$TIER" != quick ]; then run_tier api-db tier_api_db; fi
if [ "$TIER" = full ]; then run_tier browser tier_browser; fi
wait

# ---------------------------------------------------------------- result ---------------------
TIERS=(api-lint api-db receiver tooling mobile browser)
for t in "${TIERS[@]}"; do
    [ -f "$RUN/$t.log" ] || continue
    { echo; echo "######## tier: $t"; cat "$RUN/$t.log"; } >>"$LOG"
done
SUMMARY="$RUN/summary"
for t in "${TIERS[@]}"; do [ -f "$RUN/$t.sum" ] && sed "s/^/[$t] /" "$RUN/$t.sum"; done >"$SUMMARY"
ELAPSED=$(( $(date +%s) - T_START ))
say "---- summary ($TIER, ${ELAPSED}s wall) ----"
tee -a "$LOG" <"$SUMMARY"

NFAIL=$(grep -c '\] FAIL' "$SUMMARY")
NTOTAL=$(grep -c -E '\] (PASS|FAIL)' "$SUMMARY")
NSKIP=$(grep -c '\] SKIP' "$SUMMARY")
# A tier that died before recording anything is a failure too.
REQUIRED=(api-lint receiver tooling mobile)
[ "$TIER" != quick ] && REQUIRED+=(api-db)
for t in "${REQUIRED[@]}"; do [ -s "$RUN/$t.sum" ] || { say "tier $t produced no results"; NFAIL=$((NFAIL + 1)); }; done
if [ "$NFAIL" -eq 0 ]; then FAILED=0; STATE=success; DESC="$NTOTAL checks passed, $NSKIP skipped (${ELAPSED}s)"
else FAILED=1; STATE=failure; DESC="$NFAIL of $NTOTAL checks failed (${ELAPSED}s)"; fi

if [ -n "${OPS_CI_NO_POST:-}" ] || [ "$TIER" = quick ]; then
    say "not posting $CONTEXT=$STATE ($DESC)"
    say "log: $LOG"
    exit "$FAILED"
fi

cd "$REPO" || die "no $REPO"
POST_ERR="$(gh api "repos/:owner/:repo/statuses/$SHA" \
    -f state="$STATE" -f context="$CONTEXT" -f description="$DESC" 2>&1 >/dev/null)"
POST_RC=$?
if [ "$POST_RC" -ne 0 ]; then
    if grep -qE 'HTTP 403|\(403\)' <<<"$POST_ERR"; then
        say "WARNING: posting status '$CONTEXT=$STATE' got 403 (token lacks statuses:write?). gh said: $POST_ERR"
        POST_RC=0
    else
        say "ERROR: posting status failed: $POST_ERR"
    fi
else
    say "posted $CONTEXT=$STATE on $SHA ($DESC)"
fi
say "log: $LOG"
[ "$POST_RC" -eq 0 ] || exit 3
exit "$FAILED"
