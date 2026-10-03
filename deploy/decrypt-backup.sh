#!/usr/bin/env bash
# Run on an authorized recovery host, never the backup storage VPS.
# This validates a gzip archive; it does not import SQL into any database.
set -euo pipefail
umask 077
source_file=${1:?encrypted archive required}
identity=${2:?private age identity file required}
destination=${3:?new validated gzip archive path required}
test -f "$source_file"
test -s "$identity"
if [ -e "$destination" ] || [ -L "$destination" ]; then
    echo 'Refusing to replace an existing recovery archive' >&2
    exit 1
fi
partial=$(mktemp "$(dirname "$destination")/.decrypted-backup.XXXXXX")
trap 'rm -f -- "$partial"' EXIT
# Do not stream unauthenticated/partial plaintext to a database or final file.
age --decrypt --identity "$identity" --output "$partial" "$source_file"
gzip -t "$partial"
ln -- "$partial" "$destination"
echo 'Authenticated gzip archive published; database restore has not been run'
