#!/usr/bin/env bash
# Run the full pre-PR checks from CLAUDE.md against one commit and post the result
# as a GitHub commit status named "ops/ci".
#
#   ops/ci.sh <sha>
#
# - Checks <sha> out in a throwaway worktree under /srv/mento/ci-work/ (the caller's
#   checkout is never touched) and removes it on exit.
# - Everything is logged to /srv/mento/logs/ci/<full-sha>.log.
# - The local test DB (Postgres 127.0.0.1:5432, Redis 127.0.0.1:6379) is shared with
#   other sessions and is never started or stopped here. Every DB-using step
#   (alembic upgrade/check, pytest) runs inside ONE block wrapped in
#       flock /srv/mento/locks/testdb.lock <command>
#   so another session cannot interleave a TRUNCATE-ing pytest run between them.
#   Any other session that touches the test DB should wrap its commands the same way.
# - The DB URL is forced to 127.0.0.1 regardless of the caller's environment: the
#   suite TRUNCATEs tables, so it must never see a real DB.
# - OPS_CI_NO_POST=1 runs the checks without posting a status.
# - Exit code: 0 all checks passed; 1 a check failed; 2 usage/setup error;
#   3 the status post failed for a reason other than 403. A 403 is reported and
#   is NOT worked around; the exit code then reflects the checks alone.
set -uo pipefail

ROOT=/srv/mento
LOG_DIR="$ROOT/logs/ci"
LOCK_DIR="$ROOT/locks"
LOCK_FILE="$LOCK_DIR/testdb.lock"
WORK_DIR="$ROOT/ci-work"
CACHE_DIR="$ROOT/ci-cache"
CONTEXT="ops/ci"

die() { echo "ops/ci: $*" >&2; exit 2; }

[ $# -eq 1 ] || die "usage: ops/ci.sh <sha>"
REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || die "not in a git repo"
SHA="$(git -C "$REPO" rev-parse --verify --quiet "$1^{commit}")" || die "unknown commit: $1"

mkdir -p "$LOG_DIR" "$LOCK_DIR" "$WORK_DIR" "$CACHE_DIR"
LOG="$LOG_DIR/$SHA.log"
: > "$LOG"
SUMMARY="$(mktemp)"
OUT="$(mktemp)"
WT="$WORK_DIR/$SHA"

cleanup() {
    git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"
    git -C "$REPO" worktree prune
    rm -f "$SUMMARY" "$OUT"
}
trap cleanup EXIT

say() { echo "ops/ci: $*" | tee -a "$LOG"; }

FAILED=0
# step <name> <cmd...>: run, tee into the log, record pass/fail and the last output line.
step() {
    local name=$1 rc
    shift
    say "=== $name"
    "$@" 2>&1 | tee -a "$LOG" | tee "$OUT"
    rc=${PIPESTATUS[0]}
    if [ "$rc" -eq 0 ]; then
        echo "PASS  $name :: $(tail -n 1 "$OUT")" >> "$SUMMARY"
    else
        echo "FAIL  $name (exit $rc) :: $(tail -n 1 "$OUT")" >> "$SUMMARY"
        FAILED=1
    fi
}

say "commit $SHA"
git -C "$REPO" worktree add --detach "$WT" "$SHA" >>"$LOG" 2>&1 || die "worktree add failed (see $LOG)"

API="$WT/services/api"
MOBILE="$WT/apps/mobile"

# --- API environment: local test DB only, same values as api-ci.yml -------------
export DATABASE_URL="postgresql+psycopg://mento:mento@127.0.0.1:5432/mento"
export REDIS_URL="redis://127.0.0.1:6379/0"
export JWT_SECRET="ci-secret-at-least-32-bytes-long-000000"
export ENV=dev
unset PYTEST_XDIST_WORKER

# Venv cached by requirements hash so repeat runs don't reinstall.
REQ_HASH="$(cat "$API/requirements.txt" "$API/requirements-dev.txt" | sha256sum | cut -c1-16)"
VENV="$CACHE_DIR/venv-$REQ_HASH"
if [ ! -x "$VENV/bin/python" ]; then
    say "building venv $VENV"
    { python3.12 -m venv "$VENV" && "$VENV/bin/pip" install --quiet -r "$API/requirements-dev.txt"; } >>"$LOG" 2>&1 \
        || { rm -rf "$VENV"; die "venv build failed (see $LOG)"; }
fi
PY="$VENV/bin/python"

cd "$API" || die "no $API"

step "ruff check" "$PY" -m ruff check .
step "black --check" "$PY" -m black --check .

# One locked block for all DB-using steps. The block runs in a child bash, so it
# cannot set FAILED here; the summary file carries the results back instead.
db_block() {
    step "alembic upgrade head" "$PY" -m alembic upgrade head
    step "alembic check" "$PY" -m alembic check
    step "pytest" "$PY" -m pytest -q
    # Required: fails CI on a breaking OpenAPI change vs services/api/openapi.snapshot.json.
    # Imports the app against the local test DB settings, so it runs inside the lock.
    step "openapi_compat check" bash -c 'cd "$1" && "$2" scripts/ci/openapi_compat.py check' _ "$WT" "$PY"
}
export -f db_block step say
export PY LOG SUMMARY OUT WT
say "waiting for $LOCK_FILE"
flock "$LOCK_FILE" bash -c 'FAILED=0; db_block'
if grep -q '^FAIL' "$SUMMARY"; then FAILED=1; fi

# --- Release tooling unit tests (drills against fakes; no DB, no docker) ----------
step "scripts/ci unittests" bash -c 'cd "$1" && python3 -m unittest discover -s scripts/ci -p "test_*.py"' _ "$WT"

# --- Mobile ---------------------------------------------------------------------
cd "$MOBILE" || die "no $MOBILE"
step "npm ci" npm ci --no-audit --no-fund
step "typecheck" npm run typecheck
for t in route question placement bubble; do
    step "test:$t" npm run "test:$t"
done
step "node --test e2e/*.test.cjs" node --test e2e/*.test.cjs

# --- Result ---------------------------------------------------------------------
say "---- summary ----"
tee -a "$LOG" < "$SUMMARY"

if [ "$FAILED" -eq 0 ]; then STATE=success; DESC="all pre-PR checks passed"; else STATE=failure
    DESC="$(grep -c '^FAIL' "$SUMMARY") of $(wc -l < "$SUMMARY") checks failed"; fi

# OPS_CI_NO_POST=1 skips the GitHub post (dry runs, local debugging).
if [ -n "${OPS_CI_NO_POST:-}" ]; then
    say "OPS_CI_NO_POST set: not posting $CONTEXT=$STATE"
    say "log: $LOG"
    exit "$FAILED"
fi

# gh resolves :owner/:repo from the repo it is run in.
cd "$REPO" || die "no $REPO"
POST_ERR="$(gh api "repos/:owner/:repo/statuses/$SHA" \
    -f state="$STATE" -f context="$CONTEXT" -f description="$DESC" 2>&1 >/dev/null)"
POST_RC=$?
if [ "$POST_RC" -ne 0 ]; then
    if grep -qE 'HTTP 403|\(403\)' <<<"$POST_ERR"; then
        say "WARNING: posting status '$CONTEXT=$STATE' got 403 (token lacks statuses:write?). Not retrying or working around it. gh said: $POST_ERR"
        POST_RC=0
    else
        say "ERROR: posting status failed: $POST_ERR"
    fi
else
    say "posted $CONTEXT=$STATE on $SHA"
fi

say "log: $LOG"
[ "$POST_RC" -eq 0 ] || exit 3
exit "$FAILED"
