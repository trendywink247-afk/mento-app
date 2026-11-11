# shellcheck shell=bash
# ops/lib/prod-guards.sh — the two checks every production change must pass. Sourced by
# ops/prod-release.sh and ops/ota-publish.sh; unit-tested by scripts/ci/test_prod_guards.py.
#
#   prod_repo_git <repo> <git args...>   git as the repo's owner (root may not run git in an
#                                        agent-owned checkout: "dubious ownership")
#   prod_on_main <repo> <sha>            0 when <sha> is a commit reachable from origin/main
#                                        (fetches origin main first unless PROD_NO_FETCH=1)
#   prod_ci_passed <log-dir> <sha>       0 when ops/ci.sh recorded a full pass for <sha>
#
# Production deploys only what is on main (founder rule, CLAUDE.md), and only what the
# local CI gate passed. Both functions print one line saying why they refused.

prod_repo_git() {
  local repo=$1 owner
  shift
  owner=$(stat -c %U "$repo")
  if [ "$(id -u)" -eq 0 ] && [ "$owner" != root ]; then
    sudo -u "$owner" -H git -C "$repo" "$@"
  else
    git -C "$repo" "$@"
  fi
}

prod_on_main() {
  local repo=$1 sha=$2 full
  [[ $sha =~ ^[0-9a-f]{7,40}$ ]] || { echo "prod-guard: '$sha' is not a commit sha" >&2; return 1; }
  if [ "${PROD_NO_FETCH:-}" != 1 ]; then
    prod_repo_git "$repo" fetch -q origin main \
      || { echo "prod-guard: could not fetch origin main" >&2; return 1; }
  fi
  full=$(prod_repo_git "$repo" rev-parse --verify --quiet "$sha^{commit}") \
    || { echo "prod-guard: unknown commit $sha" >&2; return 1; }
  prod_repo_git "$repo" rev-parse --verify --quiet origin/main >/dev/null \
    || { echo "prod-guard: no origin/main in $repo" >&2; return 1; }
  if ! prod_repo_git "$repo" merge-base --is-ancestor "$full" origin/main; then
    echo "prod-guard: $full is not on origin/main. Production deploys only from main;" \
      "merge dev into main first (founder approval)." >&2
    return 1
  fi
  echo "$full"
}

# Same reading as qa-deploy-api.sh: only lines after ops/ci.sh's summary marker count, so
# test output that happens to contain "PASS" cannot fake a pass.
prod_ci_passed() {
  local dir=$1 sha=$2 log summary
  [[ $sha =~ ^[0-9a-f]{40}$ ]] || { echo "prod-guard: need the full 40-char sha for the CI check" >&2; return 1; }
  log="$dir/$sha.log"
  [ -f "$log" ] || { echo "prod-guard: no ops/ci log for $sha ($log); run ops/ci.sh $sha first" >&2; return 1; }
  summary=$(awk '/^ops\/ci: ---- summary ----/ {f=1; next} f' "$log")
  if [ -z "$summary" ] || ! grep -q '^PASS' <<<"$summary" || grep -q '^FAIL' <<<"$summary"; then
    echo "prod-guard: ops/ci did not pass for $sha (see $log)" >&2
    return 1
  fi
  return 0
}
