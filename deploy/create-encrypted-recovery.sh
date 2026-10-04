#!/usr/bin/env bash
# Compose the verified snapshot exporter and age encryption. Not scheduled.
# Private recovery identities are neither needed nor accepted by this utility.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")" && pwd)
container=${1:?container required}; user=${2:?database user required}
database=${3:?database required}; recipients=${4:?public recipients required}
destination=${5:?new age archive required}
shift 5
test -s "$recipients"
test ! -e "$destination" && test ! -L "$destination"
directory=$(dirname "$destination")
# Lock covers export and encryption. Never unlink the shared lock inode.
exec 9>"$directory/.encrypted-recovery.lock"
flock --nonblock 9 || { echo 'Another encrypted export is active' >&2; exit 1; }
work=$(mktemp -d "$directory/.recovery-work.XXXXXX")
cleanup() {
  rm -f -- "$work/snapshot.sql.gz"
  rmdir -- "$work"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
bash "$root/export-recovery-snapshot.sh" "$container" "$user" "$database" "$work/snapshot.sql.gz" "$@"
bash "$root/encrypt-backup.sh" "$work/snapshot.sql.gz" "$recipients" "$destination"
echo 'Encrypted snapshot published; off-host verification and recovery acceptance still required'
