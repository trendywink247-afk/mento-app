#!/usr/bin/env bash
# Proof for the SOPS + age secrets path, with THROWAWAY keys generated here (nothing
# real is read or written). Asserts:
#   1. a dotenv file encrypted to two recipients opens with EITHER key
#      (founder key or server key — the custody rule in docs/DEPLOYMENT_VPS.md);
#   2. decrypt-env.sh's output reaches a container through `docker compose env_file`
#      byte-for-byte, including values with '#', '=', spaces and quotes;
#   3. decrypt-env.sh refuses a plaintext file, a wrong key, and a non-tmpfs output dir;
#   4. the committed .sops.yaml refuses to encrypt while its recipients are placeholders.
# Needs: sops, age-keygen, docker (compose v2). Exit 0 = every assertion held.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fails=0
ok()   { echo "ok   $*"; }
fail() { echo "FAIL $*"; fails=$((fails+1)); }

age-keygen -o "$TMP/founder.key" 2>/dev/null
age-keygen -o "$TMP/server.key" 2>/dev/null
age-keygen -o "$TMP/stranger.key" 2>/dev/null
FOUNDER_PUB="$(age-keygen -y "$TMP/founder.key")"
SERVER_PUB="$(age-keygen -y "$TMP/server.key")"

# Values chosen to break naive dotenv handling. No '$': compose interpolates it in
# env_file values (see docs/DEPLOYMENT_VPS.md — generate secrets without '$').
cat > "$TMP/plain.env" <<'EOF'
ENV=prod
JWT_SECRET=aB3#not-a-comment xyz
STREAM_API_SECRET=k=v=w
QUOTED="double quoted"
APOS=it's-fine
EMPTY=
EOF

# The exact migration command the runbook gives (an existing .env → encrypted YAML),
# run against a copy of the COMMITTED rules with the two placeholders swapped for the
# throwaway keys — this proves the path_regex matches and both recipients are used.
mkdir -p "$TMP/repo/deploy/secrets"
sed -e "s|REPLACE_WITH_FOUNDER_AGE_PUBLIC_KEY|$FOUNDER_PUB|" \
    -e "s|REPLACE_WITH_SERVER_AGE_PUBLIC_KEY|$SERVER_PUB|" "$ROOT/.sops.yaml" > "$TMP/repo/.sops.yaml"
cp "$TMP/plain.env" "$TMP/repo/services.env"
(cd "$TMP/repo" && sops --encrypt --filename-override deploy/secrets/prod.env.sops.yaml \
    --input-type dotenv --output-type yaml services.env > deploy/secrets/prod.env.sops.yaml)
cp "$TMP/repo/deploy/secrets/prod.env.sops.yaml" "$TMP/prod.env.sops.yaml"
grep -q '^sops:' "$TMP/prod.env.sops.yaml" && ! grep -q 'not-a-comment' "$TMP/prod.env.sops.yaml" \
    && ok "the runbook command encrypts under the committed rule, no plaintext left" \
    || fail "encrypted file leaks plaintext or lacks metadata"
[ "$(grep -c 'recipient: age1' "$TMP/prod.env.sops.yaml")" = 2 ] \
    && ok "encrypted to exactly two recipients" || fail "recipient count is not 2"

export MENTO_ALLOW_DISK_ENV=1
for who in founder server; do
    if SOPS_AGE_KEY_FILE="$TMP/$who.key" "$HERE/decrypt-env.sh" \
        "$TMP/prod.env.sops.yaml" "$TMP/out-$who/api.env" >/dev/null; then
        ok "the $who key opens it"
    else
        fail "the $who key could not open it"
    fi
done
[ "$(stat -c %a "$TMP/out-server/api.env")" = 600 ] && ok "output is mode 600" || fail "output mode is $(stat -c %a "$TMP/out-server/api.env")"

# What the API container actually sees, via compose's own env_file parser.
cat > "$TMP/probe.sh" <<'EOF'
for k in ENV JWT_SECRET STREAM_API_SECRET QUOTED APOS EMPTY; do
  eval "v=\${$k-UNSET}"; printf '%s=[%s]\n' "$k" "$v"
done
EOF
cat > "$TMP/compose.yml" <<EOF
services:
  probe:
    image: alpine:3
    env_file: ["$TMP/out-server/api.env"]
    volumes: ["$TMP/probe.sh:/probe.sh:ro"]
    command: ["sh", "/probe.sh"]
EOF
GOT="$(docker compose -p mento-secrets-proof -f "$TMP/compose.yml" run --rm -T probe 2>/dev/null)"
WANT='ENV=[prod]
JWT_SECRET=[aB3#not-a-comment xyz]
STREAM_API_SECRET=[k=v=w]
QUOTED=[double quoted]
APOS=[it'"'"'s-fine]
EMPTY=[]'
if [ "$GOT" = "$WANT" ]; then ok "compose env_file delivers every value intact"
else fail "compose env_file mangled values:"; diff <(echo "$WANT") <(echo "$GOT") || true; fi

# Refusals.
if SOPS_AGE_KEY_FILE="$TMP/stranger.key" "$HERE/decrypt-env.sh" \
    "$TMP/prod.env.sops.yaml" "$TMP/out-stranger/api.env" >/dev/null 2>&1; then
    fail "a key that is not a recipient decrypted the file"
else ok "a non-recipient key is refused"; fi
[ ! -e "$TMP/out-stranger/api.env" ] && ok "a failed decrypt leaves no output file" || fail "a failed decrypt left an output file"

cp "$TMP/plain.env" "$TMP/plain.sops.yaml"
if SOPS_AGE_KEY_FILE="$TMP/server.key" "$HERE/decrypt-env.sh" \
    "$TMP/plain.sops.yaml" "$TMP/out-plain/api.env" >/dev/null 2>&1; then
    fail "a plaintext file was accepted"
else ok "a plaintext file is refused"; fi

# A directory that is certainly on disk (the repo's gitignored .secrets/), so this
# holds even on a box whose /tmp is itself tmpfs.
DISK="$(mkdir -p "$ROOT/.secrets" && mktemp -d -p "$ROOT/.secrets")"
if SOPS_AGE_KEY_FILE="$TMP/server.key" MENTO_ALLOW_DISK_ENV='' "$HERE/decrypt-env.sh" \
    "$TMP/prod.env.sops.yaml" "$DISK/api.env" >/dev/null 2>&1; then
    fail "wrote plaintext to a non-tmpfs directory"
else ok "a non-tmpfs output directory is refused"; fi
[ ! -e "$DISK/api.env" ] && ok "…and wrote nothing there" || fail "plaintext left on disk at $DISK"
rm -rf "$DISK"

# A '$' in a value would be rewritten by compose — refused, naming the key.
printf 'OK_KEY=fine\nDB_PASSWORD=pa$$word\n' > "$TMP/dollar.env"
(cd "$TMP" && sops --encrypt --input-type dotenv --output-type yaml --age "$SERVER_PUB" \
    dollar.env > dollar.sops.yaml)
if MSG="$(SOPS_AGE_KEY_FILE="$TMP/server.key" "$HERE/decrypt-env.sh" \
    "$TMP/dollar.sops.yaml" "$TMP/out-dollar/api.env" 2>&1)"; then
    fail "a value containing '\$' was accepted"
elif echo "$MSG" | grep -q DB_PASSWORD && [ ! -e "$TMP/out-dollar/api.env" ]; then
    ok "a value containing '\$' is refused, naming the key, with no output"
else fail "'\$' refusal did not name the key or left output: $MSG"; fi

# The committed rules, as committed, must not encrypt to their placeholders.
mkdir -p "$TMP/raw/deploy/secrets"
cp "$ROOT/.sops.yaml" "$TMP/raw/.sops.yaml"
cp "$TMP/plain.env" "$TMP/raw/services.env"
if (cd "$TMP/raw" && sops --encrypt --filename-override deploy/secrets/prod.env.sops.yaml \
        --input-type dotenv --output-type yaml services.env) >/dev/null 2>&1; then
    fail ".sops.yaml encrypted to its placeholder recipients"
else ok ".sops.yaml refuses to encrypt until the real public keys are in"; fi

[ "$fails" -eq 0 ] && echo "secrets proof: all assertions held" || { echo "secrets proof: $fails failure(s)"; exit 1; }
