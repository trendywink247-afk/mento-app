#!/usr/bin/env bash
# Local security scan (replaces the former .github/workflows/security.yml). Report only.
#
#   ops/security-scan.sh [--sha <commit>] [--strict]
#
# Scans <commit> (default origin/dev) in a throwaway worktree with pinned, checksum-verified
# tools from /srv/mento/ci-cache/tools (ops/lib/ci-tools.sh):
#   bandit, pip-audit (API + recovery receiver), semgrep, npm audit (production deps),
#   osv-scanner (mobile lockfile), gitleaks (full history, values redacted), trivy config.
# Then runs ops/sonar-scan.sh when present (it skips cleanly without a server or token).
#
# Report: /srv/mento/logs/security/<YYYY-MM-DD>-<sha12>.md (raw tool output alongside, *.d/).
# Exit 0 with a findings count, unless --strict, which exits 1 when any tool reports findings.
# Allowlists live in the repo (.bandit, .gitleaks.toml, .semgrepignore); review new entries
# as security changes. Gitleaks runs with --redact, so a secret value never reaches the report.
set -uo pipefail

ROOT=/srv/mento
OUT_DIR="$ROOT/logs/security"
WORK_DIR="$ROOT/ci-work"
STRICT=0
REF=origin/dev
while [ $# -gt 0 ]; do
    case "$1" in
        --sha) REF=$2; shift 2 ;;
        --strict) STRICT=1; shift ;;
        *) echo "usage: ops/security-scan.sh [--sha <commit>] [--strict]" >&2; exit 2 ;;
    esac
done

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
# shellcheck source=ops/lib/ci-tools.sh
. "$REPO/ops/lib/ci-tools.sh"
git -C "$REPO" fetch --quiet origin 2>/dev/null || true
SHA="$(git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}")" || { echo "unknown commit: $REF" >&2; exit 2; }

mkdir -p "$OUT_DIR" "$WORK_DIR"
exec 8>"$ROOT/locks/security-scan.lock"
flock --nonblock 8 || { echo "security-scan: another scan is running"; exit 0; }
STAMP="$(date -u +%F)-${SHA:0:12}"
REPORT="$OUT_DIR/$STAMP.md"
RAW="$OUT_DIR/$STAMP.d"
mkdir -p "$RAW"
WT="$WORK_DIR/security-$SHA-$$"
# shellcheck disable=SC2317 # called by the EXIT trap
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; git -C "$REPO" worktree prune; }
trap cleanup EXIT
git -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null 2>&1 || { echo "worktree add failed" >&2; exit 2; }
cd "$WT" || exit 2

TOTAL=0
ROWS=()
# scan <name> <count-command> -- <tool command...>: run the tool into $RAW/<name>.txt, then count
# findings with <count-command> (a shell snippet reading the raw file on stdin).
scan() {
    local name=$1 counter=$2 rc n t0
    shift 3
    t0=$(date +%s)
    "$@" >"$RAW/$name.txt" 2>&1
    rc=$?
    n="$(bash -c "$counter" <"$RAW/$name.txt" 2>/dev/null)"
    [[ "$n" =~ ^[0-9]+$ ]] || n="?"
    [ "$n" != "?" ] && TOTAL=$((TOTAL + n))
    ROWS+=("| $name | $n | $rc | $(( $(date +%s) - t0 ))s | \`$name.txt\` |")
}

VENV="$(scanner_venv)" || { echo "scanner venv unavailable" >&2; exit 2; }
export SEMGREP_ENABLE_VERSION_CHECK=0 SEMGREP_SEND_METRICS=off

scan bandit "grep -c '^>> Issue:'" -- \
    "$VENV/bin/bandit" --ini .bandit -r services/api/app services/recovery_receiver -x '*/tests/*' -f txt
scan pip-audit-api "grep -cE '^[A-Za-z0-9_.-]+ +[0-9][^ ]* +(GHSA|PYSEC|CVE)'" -- \
    "$VENV/bin/pip-audit" -r services/api/requirements.txt --progress-spinner off
scan pip-audit-receiver "grep -cE '^[A-Za-z0-9_.-]+ +[0-9][^ ]* +(GHSA|PYSEC|CVE)'" -- \
    "$VENV/bin/pip-audit" -r services/recovery_receiver/requirements.txt --progress-spinner off
scan semgrep "grep -oE 'Ran .* rules on .* files: [0-9]+ findings' | grep -oE '[0-9]+ findings' | grep -oE '[0-9]+'" -- \
    "$VENV/bin/semgrep" scan --metrics=off --config p/python --config p/owasp-top-ten --config p/typescript \
    services/api/app services/recovery_receiver apps/mobile/app apps/mobile/lib apps/mobile/components
scan npm-audit "grep -oE '^[0-9]+ vulnerabilities' | grep -oE '^[0-9]+' || echo 0" -- \
    bash -c 'cd apps/mobile && npm audit --omit=dev --package-lock-only'
if OSV="$(tool_path osv-scanner)"; then
    scan osv-scanner "grep -cE '^\| https://osv.dev/'" -- "$OSV" scan source --lockfile apps/mobile/package-lock.json
else ROWS+=("| osv-scanner | ? | install failed | | |"); fi
if GL="$(tool_path gitleaks)"; then
    # Full history needs the real repository, not the detached worktree's shallow view.
    scan gitleaks "grep -oE 'leaks found: [0-9]+' | grep -oE '[0-9]+' || echo 0" -- \
        "$GL" detect --source "$REPO" --log-opts "$SHA" --config .gitleaks.toml --redact --no-banner
else ROWS+=("| gitleaks | ? | install failed | | |"); fi
if TV="$(tool_path trivy)"; then
    scan trivy-config "grep -cE '^[A-Z]+-[0-9]+ \(|^ *(HIGH|CRITICAL):'" -- \
        "$TV" config --severity HIGH,CRITICAL --quiet --cache-dir "$CI_TOOLS/trivy-cache" .
else ROWS+=("| trivy-config | ? | install failed | | |"); fi

SONAR="skipped (ops/sonar-scan.sh not on this commit)"
if [ -x "$REPO/ops/sonar-scan.sh" ]; then
    if "$REPO/ops/sonar-scan.sh" >"$RAW/sonar.txt" 2>&1; then SONAR="ran — see \`sonar.txt\`"; else SONAR="failed — see \`sonar.txt\`"; fi
fi

{
    echo "# Security scan $(date -u '+%F %H:%M') UTC"
    echo
    echo "Commit \`$SHA\` ($REF). Findings are counts from each tool's own output; triage them against"
    echo "\`docs/SECURITY_AUDIT.md\`. Raw output: \`$RAW/\`."
    echo
    echo "| Tool | Findings | Exit | Time | Raw |"
    echo "|---|---|---|---|---|"
    printf '%s\n' "${ROWS[@]}"
    echo
    echo "Total counted findings: **$TOTAL**. SonarQube: $SONAR."
} >"$REPORT"
cat "$REPORT"
echo "report: $REPORT"
if [ "$STRICT" -eq 1 ] && [ "$TOTAL" -gt 0 ]; then exit 1; fi
exit 0
