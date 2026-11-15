#!/usr/bin/env bash
# Weekly dependency report (replaces Dependabot). Report only: it opens no PRs and changes nothing.
#
#   ops/deps-check.sh [--sha <commit>]
#
# Report: /srv/mento/logs/deps/<YYYY-MM-DD>-<sha12>.md with three sections:
#   1. npm, freely updatable: minor/patch updates for packages outside the Expo pin set.
#   2. npm, Expo-managed: what `npx expo install --check` says is out of line with the SDK.
#      Those packages (expo, expo-*, @expo/*, react-native*, react, react-dom, Skia, Sentry RN,
#      lottie, stream-chat-expo, ...) move only with `npx expo install --fix` or an SDK upgrade.
#   3. pip (services/api, services/recovery_receiver): newest minor/patch within the pinned major.
# Majors are listed separately as "needs a plan", never as a routine update (same rules the old
# .github/dependabot.yml enforced).
set -uo pipefail

ROOT=/srv/mento
OUT_DIR="$ROOT/logs/deps"
WORK_DIR="$ROOT/ci-work"
CACHE_DIR="$ROOT/ci-cache"
REF=origin/dev
[ "${1:-}" = "--sha" ] && { REF=$2; shift 2; }
[ $# -eq 0 ] || { echo "usage: ops/deps-check.sh [--sha <commit>]" >&2; exit 2; }

REPO="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)" || exit 2
git -C "$REPO" fetch --quiet origin 2>/dev/null || true
SHA="$(git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}")" || { echo "unknown commit: $REF" >&2; exit 2; }
mkdir -p "$OUT_DIR" "$WORK_DIR"
REPORT="$OUT_DIR/$(date -u +%F)-${SHA:0:12}.md"
WT="$WORK_DIR/deps-$SHA-$$"
TMP="$(mktemp -d)"
cleanup() { git -C "$REPO" worktree remove --force "$WT" >/dev/null 2>&1 || rm -rf "$WT"; git -C "$REPO" worktree prune; rm -rf "$TMP"; }
trap cleanup EXIT
git -C "$REPO" worktree add --detach "$WT" "$SHA" >/dev/null 2>&1 || { echo "worktree add failed" >&2; exit 2; }

cd "$WT/apps/mobile" || exit 2
# Reuse the CI node_modules cache for this lockfile when there is one (read-only hard links).
NM="$CACHE_DIR/node_modules-$(sha256sum package-lock.json | cut -c1-16)"
if [ -d "$NM" ]; then cp -al "$NM" node_modules; else SKIP_SKIA_DOWNLOAD=1 npm ci --no-audit --no-fund >/dev/null 2>&1; fi
npm outdated --json >"$TMP/npm.json" 2>/dev/null
EXPO_NO_DOTENV=1 npx expo install --check >"$TMP/expo.txt" 2>&1
EXPO_RC=$?

python3 - "$TMP/npm.json" "$TMP/expo.txt" "$EXPO_RC" "$WT" "$SHA" "$REF" >"$REPORT" <<'PY'
import json, re, sys, urllib.request
from pathlib import Path

npm_json, expo_txt, expo_rc, wt, sha, ref = sys.argv[1:]
PINNED = re.compile(r"^(expo|expo-.*|@expo/.*|react-native|react-native-.*|@react-native-community/.*|"
                    r"@react-native-picker/.*|@shopify/react-native-skia|@sentry/react-native|lottie-react-native|"
                    r"stream-chat-expo|react|react-dom)$")

def major(v):
    m = re.match(r"\D*(\d+)", v or "")
    return int(m.group(1)) if m else None

def vkey(v):
    return tuple(int(x) for x in re.findall(r"\d+", v)[:3])

out = [f"# Dependency report {__import__('datetime').date.today()}", "",
       f"Commit `{sha}` ({ref}). Report only; nothing was changed.", ""]

try:
    npm = json.loads(Path(npm_json).read_text() or "{}")
except json.JSONDecodeError:
    npm = {}
free, majors, pinned = [], [], []
for name, info in sorted(npm.items()):
    if isinstance(info, list):
        info = info[0]
    cur, wanted, latest = info.get("current"), info.get("wanted"), info.get("latest")
    row = f"| {name} | {cur} | {wanted} | {latest} |"
    if PINNED.match(name):
        pinned.append(row)
    elif major(latest) != major(cur):
        majors.append(row)
        if wanted and wanted != cur:
            free.append(f"| {name} | {cur} | {wanted} | (major {latest} listed below) |")
    elif name == "@types/react" and latest.split(".")[:2] != (cur or "").split(".")[:2]:
        pinned.append(row)
    else:
        free.append(row)

hdr = ["| Package | Current | Wanted | Latest |", "|---|---|---|---|"]
out += ["## 1. npm: minor/patch outside the Expo pin set", ""] + (hdr + free if free else ["None."]) + [""]
out += ["## 2. npm: Expo-managed (move with `npx expo install --fix` or an SDK upgrade)", "",
        "`npx expo install --check` said:", "", "```", Path(expo_txt).read_text().strip()[-4000:] or "(no output)", "```", ""]
if pinned:
    out += ["Registry has newer versions of these pinned packages (informational):", ""] + hdr + pinned + [""]
out += ["## Majors (need a plan, never routine)", ""] + (hdr + majors if majors else ["None."]) + [""]

out += ["## 3. pip: newest minor/patch within the pinned major", "",
        "| File | Package | Pinned | Newest same-major | Newest overall |", "|---|---|---|---|---|"]
rows = 0
for req in ("services/api/requirements.txt", "services/recovery_receiver/requirements.txt"):
    p = Path(wt) / req
    if not p.exists():
        continue
    for line in p.read_text().splitlines():
        m = re.match(r"^([A-Za-z0-9_.\-]+)(\[[^\]]*\])?==([^\s#;]+)", line.strip())
        if not m:
            continue
        name, pin = m.group(1), m.group(3)
        try:
            with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=20) as r:
                releases = json.load(r)["releases"]
        except Exception as exc:  # network or unknown package: say so, keep going
            out.append(f"| {req} | {name} | {pin} | lookup failed ({type(exc).__name__}) | |"); rows += 1
            continue
        good = [v for v, files in releases.items()
                if files and re.fullmatch(r"\d+(\.\d+)*", v) and not all(f.get("yanked") for f in files)]
        if not good:
            continue
        same = [v for v in good if major(v) == major(pin)]
        best_same = max(same, key=vkey) if same else pin
        best = max(good, key=vkey)
        if vkey(best_same) > vkey(pin) or vkey(best) > vkey(pin):
            out.append(f"| {req} | {name} | {pin} | {best_same if vkey(best_same) > vkey(pin) else '-'} | {best} |")
            rows += 1
if not rows:
    out.append("| - | - | - | all current | - |")
print("\n".join(out))
PY
echo "report: $REPORT"
