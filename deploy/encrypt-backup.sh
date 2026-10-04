#!/usr/bin/env bash
# Explicit preparation utility; not yet wired into scheduled production backups.
# Keep the private age identity outside both VPS servers. Recipients are public.
set -euo pipefail
umask 077
source_file=${1:?gzip backup required}
recipients=${2:?age public recipient file required}
destination=${3:?new encrypted archive path required}
test -f "$source_file"
test -s "$recipients"
if [ -e "$destination" ] || [ -L "$destination" ]; then
    echo 'Refusing to replace an existing archive' >&2
    exit 1
fi
gzip -t "$source_file"
partial=$(mktemp "$(dirname "$destination")/.encrypted-backup.XXXXXX")
trap 'rm -f -- "$partial"' EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
age --encrypt --recipients-file "$recipients" --output "$partial" "$source_file"
test -s "$partial"
# A hard link publishes without overwriting an existing destination, including
# one created concurrently. The temporary file lives on the same filesystem.
ln -- "$partial" "$destination"
echo 'Encrypted archive published; source archive retained'
