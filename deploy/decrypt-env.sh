#!/usr/bin/env bash
# Decrypts the SOPS-encrypted production env file into a tmpfs-backed file that
# docker compose reads as `env_file`. Plaintext secrets never touch the disk: the
# output lives in the deploy user's runtime dir (/run/user/<uid>, a tmpfs that
# systemd creates at login and wipes at logout/reboot).
#
#   deploy/decrypt-env.sh                         # defaults below; prints the output path
#   deploy/decrypt-env.sh <in.sops.yaml> <out>    # explicit paths (tests use this)
#
# The age private key is read from sops' default location for the calling user
# (~/.config/sops/age/keys.txt) unless SOPS_AGE_KEY_FILE says otherwise.
# Key custody: docs/DEPLOYMENT_VPS.md → "Secrets (SOPS + age)".
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${1:-$HERE/secrets/prod.env.sops.yaml}"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
OUT="${2:-$RUNTIME_DIR/mento/api.env}"

die() { echo "[decrypt-env] $*" >&2; exit 1; }

command -v sops >/dev/null || die "sops is not installed (docs/DEPLOYMENT_VPS.md → Secrets)"
[ -f "$SRC" ] || die "no encrypted env at $SRC"
# A plaintext file with the .sops.yaml name would otherwise "decrypt" to itself.
grep -q '^sops:' "$SRC" || die "$SRC is not SOPS-encrypted — refusing to use it"

OUT_DIR="$(dirname "$OUT")"
mkdir -p "$OUT_DIR" && chmod 700 "$OUT_DIR"
# Plaintext secrets belong on tmpfs only. MENTO_ALLOW_DISK_ENV=1 is for the test
# script, which writes into a throwaway temp dir.
if [ "${MENTO_ALLOW_DISK_ENV:-}" != 1 ] && [ "$(stat -f -c %T "$OUT_DIR")" != tmpfs ]; then
    die "$OUT_DIR is not on tmpfs — plaintext secrets would land on disk"
fi

umask 077
TMP="$(mktemp "$OUT_DIR/.api.env.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
sops --decrypt --output-type dotenv "$SRC" > "$TMP"
[ -s "$TMP" ] || die "decryption produced an empty file"
# docker compose interpolates '$' inside env_file values ("x$HOMEy" arrives as "x"),
# so a secret containing one would reach the API silently rewritten. Refuse instead.
BAD="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=.*\$' "$TMP" | cut -d= -f1 | paste -sd, -)" || true
[ -z "$BAD" ] || die "value(s) for $BAD contain '\$' — compose would rewrite them; regenerate without '\$'"
mv -f "$TMP" "$OUT"   # atomic: compose never reads a half-written file
trap - EXIT
echo "$OUT"
