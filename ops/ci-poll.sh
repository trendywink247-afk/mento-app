#!/usr/bin/env bash
# Run ops/ci.sh for every new branch head on origin, so each commit gets an "ops/ci"
# status without anyone remembering to run it. Meant for a systemd timer (see
# infra/systemd/mento-ci-poll.*), running as the repo owner `agent`.
#
#   ops/ci-poll.sh            # fetch, then run ci.sh for unseen heads (max 3 per run)
#   POLL_DRY_RUN=1 ops/ci-poll.sh   # fetch and list what would run; run nothing
#   ops/ci-poll.sh --seed     # mark every current head as seen, run nothing. Do this once
#                             # before enabling the timer, or it CIs every old branch.
#
# - Branches polled: dev, main and feat/*. dependabot/* and everything else is skipped.
# - A sha is recorded in /srv/mento/logs/ci/polled/<sha> after its run, pass or fail, so
#   a failing commit is not re-run every tick. Push a new commit to re-run.
# - One poller at a time (flock on ci-poll.lock). ops/ci.sh takes testdb.lock itself.
set -uo pipefail

ROOT=/srv/mento
REPO="${POLL_REPO:-$ROOT/mento-app}"
STATE="$ROOT/logs/ci/polled"
LOCK="$ROOT/locks/ci-poll.lock"
MAX_PER_RUN=3

mkdir -p "$STATE" "$ROOT/locks"
exec 8>"$LOCK"
flock --nonblock 8 || { echo "ci-poll: another poll is running"; exit 0; }

git -C "$REPO" fetch --quiet --prune origin || { echo "ci-poll: fetch failed" >&2; exit 1; }

ran=0
while read -r sha ref; do
    [ -e "$STATE/$sha" ] && continue
    if [ "${1:-}" = "--seed" ]; then
        echo "seeded $ref $(date -u +%FT%TZ)" > "$STATE/$sha"
        echo "ci-poll: seeded $sha ($ref)"
        continue
    fi
    if [ -n "${POLL_DRY_RUN:-}" ]; then
        echo "ci-poll: would run ops/ci.sh $sha ($ref)"
        continue
    fi
    [ "$ran" -lt "$MAX_PER_RUN" ] || { echo "ci-poll: limit reached; rest next tick"; break; }
    echo "ci-poll: ops/ci.sh $sha ($ref)"
    "$REPO/ops/ci.sh" "$sha"
    echo "rc=$? ref=$ref $(date -u +%FT%TZ)" > "$STATE/$sha"
    ran=$((ran + 1))
done < <(git -C "$REPO" for-each-ref --format='%(objectname) %(refname:short)' \
            refs/remotes/origin/dev refs/remotes/origin/main 'refs/remotes/origin/feat/*')
exit 0
