#!/usr/bin/env bash
# Fake Docker only: no serving services, migrations or network access.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir -p "$temp/bin" "$temp/state"
cat > "$temp/bin/docker" <<'MOCK'
#!/usr/bin/env bash
case " $* " in
  *' ps '*) printf '%s\n' "$RUNNING_SERVICES" ;;
  *' up '*) printf 'up %s\n' "${*: -1}" >> "$DOCKER_LOG"; exit "${UP_EXIT:-0}" ;;
  *' stop '*) printf 'stop %s\n' "${*: -1}" >> "$DOCKER_LOG" ;;
  *' rm '*) printf 'rm %s\n' "${*: -1}" >> "$DOCKER_LOG" ;;
  *' logs '*) ;;
  *) echo 'Unexpected Docker invocation' >&2; exit 1 ;;
esac
MOCK
chmod +x "$temp/bin/docker"
export PATH="$temp/bin:$PATH" COMPOSE_FILE=synthetic.yml MENTO_STATE_DIR="$temp/state"
export DOCKER_LOG="$temp/docker.log" MENTO_CADDY_SETTLE=0
export RUNNING_SERVICES=$'api_blue\napi_green'
for invalid in '' api_unknown $'api_blue\napi_green'; do
  printf '%s\n' "$invalid" > "$temp/state/live-colour"
  if bash "$root/deploy/bluegreen.sh" candidate; then
    echo 'FAIL: invalid interrupted state accepted'; exit 1
  fi
  test ! -e "$DOCKER_LOG"
done
rm "$temp/state/live-colour"
mkdir "$temp/state/live-colour"
if bash "$root/deploy/bluegreen.sh" candidate; then
  echo 'FAIL: unreadable interrupted state accepted'; exit 1
fi
test ! -e "$DOCKER_LOG"
rmdir "$temp/state/live-colour"
printf 'api_green\n' > "$temp/state/live-colour"
bash "$root/deploy/bluegreen.sh" candidate >/dev/null
grep -qx 'up api_blue' "$DOCKER_LOG"
grep -qx 'stop api_green' "$DOCKER_LOG"
test "$(cat "$temp/state/live-colour")" = api_blue
rm "$DOCKER_LOG"
export RUNNING_SERVICES=api_blue UP_EXIT=1
if bash "$root/deploy/bluegreen.sh" candidate; then
  echo 'FAIL: unhealthy candidate accepted'; exit 1
fi
grep -qx 'up api_green' "$DOCKER_LOG"
grep -qx 'rm api_green' "$DOCKER_LOG"
! grep -q '^stop ' "$DOCKER_LOG"
test "$(cat "$temp/state/live-colour")" = api_blue
test -z "$(find "$temp/state" -name '.live-colour.*' -print)"
rm "$DOCKER_LOG"
touch "$temp/not-a-directory"
if MENTO_STATE_DIR="$temp/not-a-directory" bash "$root/deploy/bluegreen.sh" candidate; then
  echo 'FAIL: unavailable state storage accepted'; exit 1
fi
test ! -e "$DOCKER_LOG"
echo 'PASS: corrupt swap metadata/storage rejected before mutation; failed readiness preserves live API'
