#!/usr/bin/env bash
# Preparation utility: schema-consistent SQL/gzip export excluding chat rows.
# No schedule, retention, remote copy, encryption or live activation here.
# Usage: script CONTAINER DB_USER DB_NAME NEW_GZIP [schema.table ...]
# Explicit extra roots support isolated recovery drills; default is own chat.
set -euo pipefail
umask 077
container=${1:?container required}; user=${2:?database user required}
database=${3:?database required}; destination=${4:?new gzip path required}
shift 4
roots=("$@")
if [ "${#roots[@]}" = 0 ]; then roots=(public.chat_messages); fi
for root in "${roots[@]}"; do
  [[ "$root" =~ ^[a-z_][a-z_0-9]*\.[a-z_][a-z_0-9]*$ ]] || { echo 'Invalid exclusion root' >&2; exit 2; }
done
test ! -e "$destination" && test ! -L "$destination"
partial=$(mktemp "$(dirname "$destination")/.recovery-export.XXXXXX")
coproc SNAPSHOT { docker exec -i "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U "$user" -d "$database"; }
pid=$SNAPSHOT_PID
exec {writer}>&"${SNAPSHOT[1]}"
exec {reader}<&"${SNAPSHOT[0]}"
cleanup() {
  printf 'ROLLBACK;\n\\q\n' >&"$writer" 2>/dev/null || true
  exec {writer}>&- || true
  exec {reader}<&- || true
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  rm -f -- "$partial"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT
# Hold recursive relation locks until pg_dump finishes. These permit ordinary
# reads/writes but exclude attach/detach/rename/drop DDL on the protected tree.
# A bounded lock timeout fails instead of holding up a production migration.
printf "BEGIN; SET LOCAL lock_timeout='3s'; SET LOCAL idle_in_transaction_session_timeout='15min';\n" >&"$writer"
for root in "${roots[@]}"; do
  printf 'LOCK TABLE %s IN SHARE UPDATE EXCLUSIVE MODE;\n' "$root" >&"$writer"
done
printf 'SELECT pg_export_snapshot();\n' >&"$writer"
IFS= read -r snapshot <&"$reader"
[[ "$snapshot" =~ ^[0-9A-Fa-f]+-[0-9A-Fa-f]+-[0-9]+$ ]]
for root in "${roots[@]}"; do
  printf "SELECT format('%%I.%%I', n.nspname, c.relname) FROM pg_partition_tree('%s') p JOIN pg_class c ON c.oid=p.relid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY c.oid;\n" "$root" >&"$writer"
done
printf '\\echo EXCLUSIONS_DONE\n' >&"$writer"
exclusions=()
while IFS= read -r relation <&"$reader"; do
  [ "$relation" != EXCLUSIONS_DONE ] || break
  test -n "$relation"
  exclusions+=("--exclude-table-data=$relation")
done
test "${relation:-}" = EXCLUSIONS_DONE
test "${#exclusions[@]}" -ge "${#roots[@]}"
timeout 840 docker exec "$container" timeout 830 pg_dump -U "$user" -d "$database" \
  --snapshot="$snapshot" "${exclusions[@]}" | gzip > "$partial"
gzip -t "$partial"
printf 'COMMIT;\n\\echo SNAPSHOT_RELEASED\n' >&"$writer"
IFS= read -r released <&"$reader"
test "$released" = SNAPSHOT_RELEASED
# Publish only after both dump and locking session succeeded; never overwrite.
ln -- "$partial" "$destination"
echo 'Recovery export published; chat rows excluded; encryption/restore not performed'
