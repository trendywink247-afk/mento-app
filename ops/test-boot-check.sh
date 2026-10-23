#!/usr/bin/env bash
# Drill for ops/boot-check.sh with a fake docker, sudo and install. The "container" is the
# real checker (python -m app.boot_check) run locally with only the env file's variables, so
# this exercises the real output contract end to end: names only, never a value.
# Needs a venv with the API requirements: API_PYTHON=<python> bash ops/test-boot-check.sh
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
API_PY="${API_PYTHON:-$(ls -d /srv/mento/ci-cache/venv-*/bin/python 2>/dev/null | head -n 1)}"
[ -x "$API_PY" ] || { echo "set API_PYTHON to a python with the API requirements"; exit 2; }
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
PASS=0
FAIL=0

mkdir -p "$T/bin" "$T/ops" "$T/labels" "$T/build"
sed -e 's#^\[ "\$(id -u)" -eq 0 \].*#true#' \
    -e "s#^HERE=.*#HERE=$HERE#" \
    -e "s#^REPO=.*#REPO=$REPO#" \
    "$HERE/boot-check.sh" > "$T/ops/boot-check.sh"
chmod +x "$T/ops/boot-check.sh"

cat > "$T/bin/docker" <<'EOF'
#!/bin/bash
T="$(cd "$(dirname "$0")/.." && pwd)"
echo "docker $*" >> "$T/calls.log"
case "$1" in
  image)
    tag="${@: -1}"; tag="${tag#mento-api:}"
    [ -f "$T/labels/$tag" ] || exit 1
    case "$*" in *--format*) cat "$T/labels/$tag";; esac
    exit 0;;
  build)                                  # record the commit label against the tag
    tag=""; sha=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --tag) tag="${2#mento-api:}"; shift;;
        --label) sha="${2#org.opencontainers.image.revision=}"; shift;;
      esac; shift
    done
    echo "$sha" > "$T/labels/$tag"; exit 0;;
  run)
    envfile=""
    while [ $# -gt 0 ]; do case "$1" in --env-file) envfile="$2"; shift;; esac; shift; done
    vars=(); while IFS= read -r line; do case "$line" in ''|\#*) ;; *) vars+=("$line");; esac; done < "$envfile"
    cd "$API_DIR" && exec env -i PATH="$PATH" PYTHONPATH="$API_DIR" "${vars[@]}" "$API_PY" -m app.boot_check;;
esac
exit 0
EOF
printf '#!/bin/bash\nshift 2\nexec "$@"\n' > "$T/bin/sudo"
printf '#!/bin/bash\nfor a; do last=$a; done; mkdir -p "$last"\n' > "$T/bin/install"
chmod +x "$T/bin/"*
export API_DIR="$REPO/services/api" API_PY MENTO_BUILD_ROOT="$T/build"

KEY="k1:$(python3 -c 'import base64;print(base64.b64encode(b"k"*32).decode())')"
good_env() {
    cat > "$T/$1" <<EOT
ENV=staging
JWT_SECRET=SENTINEL-jwt-secret-value-0001
ADMIN_JWT_SECRET=SENTINEL-admin-secret-value-0002
LISTENER_JWT_SECRET=SENTINEL-listener-secret-value-0003
STREAM_API_KEY=SENTINEL-stream-key
STREAM_API_SECRET=SENTINEL-stream-secret
CORS_ORIGINS=https://app.example
MESSAGE_KEY=$KEY
DATABASE_URL=postgresql+psycopg://mento:SENTINEL-db-password@db:5432/mento
TRUSTED_PROXY_HOPS=1
EOT
}
run() { # <args...> -> OUT (stdout), ERR (stderr), RC
    PATH="$T/bin:$PATH" bash "$T/ops/boot-check.sh" "$@" > "$T/out" 2> "$T/err"; RC=$?
    OUT="$(cat "$T/out")"; ERR="$(cat "$T/err")"
}
ok() { if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "  ok   $1"; else FAIL=$((FAIL + 1)); echo "  FAIL $1"; sed 's/^/       out| /' "$T/out"; sed 's/^/       err| /' "$T/err"; fi; }
t() { if eval "$1"; then echo 0; else echo 1; fi; }

HEAD_SHA="$(git -C "$REPO" rev-parse HEAD)"

echo "== boot-check.sh"
good_env good.env
run HEAD "$T/good.env"
ok "good env file: exit 0" $((RC == 0 ? 0 : 1))
ok "good env file: stdout is empty" $(t '[ -z "$OUT" ]')
ok "good env file: stderr says PASS" $(t 'grep -q "PASS" "$T/err"')
ok "builds from the resolved commit (label = HEAD sha)" $(t 'grep -q "^docker build .*org.opencontainers.image.revision=$HEAD_SHA" "$T/calls.log"')
ok "container runs with no network and the env file" $(t 'grep -q "^docker run --rm --network none --env-file $T/good.env mento-api:.* python -m app.boot_check" "$T/calls.log"')
ok "first build is tag -r1" $(t 'grep -q "mento-api:${HEAD_SHA:0:12}-r1" "$T/calls.log"')

run HEAD "$T/good.env"
ok "a second run builds a NEW tag (-r2), never reusing -r1" $(t 'grep -q "mento-api:${HEAD_SHA:0:12}-r2" "$T/calls.log"')

grep -v '^LISTENER_JWT_SECRET=' "$T/good.env" | sed "s#^MESSAGE_KEY=.*#MESSAGE_KEY=SENTINEL-bad-id:SENTINEL-bad-body#" > "$T/bad.env"
run HEAD "$T/bad.env"
ok "bad env file: exit 1" $((RC == 1 ? 0 : 1))
ok "bad env file: stdout is exactly the failing names" $(t '[ "$OUT" = "$(printf "LISTENER_JWT_SECRET\nMESSAGE_KEY")" ]')
ok "bad env file: no value appears anywhere (stdout, stderr)" $(t '! grep -rq SENTINEL "$T/out" "$T/err"')
ok "bad env file: stderr says FAIL" $(t 'grep -q FAIL "$T/err"')

sed "s#^TRUSTED_PROXY_HOPS=.*#TRUSTED_PROXY_HOPS=SENTINEL-not-a-number#" "$T/good.env" > "$T/unparsable.env"
run HEAD "$T/unparsable.env"
ok "unparseable value: only the name is printed" $(t '[ "$OUT" = "TRUSTED_PROXY_HOPS" ] && ! grep -rq SENTINEL "$T/out" "$T/err"')

sed "s#^ENV=.*#ENV=dev#" "$T/good.env" > "$T/dev.env"
run HEAD "$T/dev.env"
ok "ENV=dev is reported as ENV (boot checks would be skipped)" $(t '[ "$RC" -eq 1 ] && [ "$OUT" = "ENV" ]')

echo "== --image reuse and provenance"
: > "$T/calls.log"
run --image "${HEAD_SHA:0:12}-r1" HEAD "$T/good.env"
ok "--image with a matching commit label: no build, exit 0" $((RC == 0 ? 0 : 1))
ok "--image: no docker build was run" $(t '! grep -q "^docker build " "$T/calls.log"')
echo "0000000000000000000000000000000000000000" > "$T/labels/stale-r1"
run --image stale-r1 HEAD "$T/good.env"
ok "--image built from another commit is refused (exit 2)" $((RC == 2 ? 0 : 1))
run --image missing-r1 HEAD "$T/good.env"
ok "--image that does not exist is refused (exit 2)" $((RC == 2 ? 0 : 1))

echo "== setup errors"
run HEAD "$T/does-not-exist.env";   ok "missing env file: exit 2" $((RC == 2 ? 0 : 1))
run no-such-ref "$T/good.env";      ok "unknown git ref: exit 2" $((RC == 2 ? 0 : 1))
run HEAD;                           ok "wrong argument count: exit 2" $((RC == 2 ? 0 : 1))

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
