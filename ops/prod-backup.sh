#!/usr/bin/env bash
# Encrypted nightly backup of the PRODUCTION Postgres on this box (run as root).
#
#   prod-backup.sh
#
# Install: infra/prod-root-setup.sh (-> /usr/local/sbin/prod-backup, timer mento-prod-backup).
# pg_dump (compose project mento-prod) -> gzip -t -> age-encrypt to the PUBLIC recipients in
# /etc/mento/age/prod.recipients (this box's backup key + the founder's offline recovery key).
# Plaintext never touches disk. Output: /opt/mento-backups/prod-encrypted/mento-prod-<stamp>.sql.gz.age
# Off-box: PROD_BACKUP_REMOTE (an rclone destination) from /etc/mento/prod-backup.env; a failed
# copy fails the run. Unset = local only, said loudly. Retention 30 days, local and remote.
# Before the first release there is no database: exits 0 and says so.
set -euo pipefail
umask 077

ROOT_DIR=${PROD_ROOT:-/opt/mento-prod}
RECIPIENTS=${PROD_AGE_RECIPIENTS:-/etc/mento/age/prod.recipients}
OUT_DIR=${PROD_BACKUP_DIR:-/opt/mento-backups/prod-encrypted}
KEEP_DAYS=30
OFFSITE_KEEP_DAYS=30
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE=$OUT_DIR/mento-prod-$STAMP.sql.gz.age

[ "$(id -u)" -eq 0 ] || { echo "prod-backup: run as root" >&2; exit 2; }
[ -s "$RECIPIENTS" ] || { echo "prod-backup: no age recipients at $RECIPIENTS" >&2; exit 2; }
command -v age >/dev/null || { echo "prod-backup: age not installed" >&2; exit 2; }
compose() { docker compose -p mento-prod -f "$ROOT_DIR/compose.yml" --env-file "$ROOT_DIR/release.env" "$@"; }
if [ ! -f "$ROOT_DIR/release.env" ] || [ -z "$(compose ps -q postgres 2>/dev/null)" ]; then
  echo "prod-backup: no production database running yet; nothing to back up"
  exit 0
fi
install -d -m 700 "$OUT_DIR"

exec 9>"$OUT_DIR/.backup.lock"
flock --nonblock 9 || { echo "prod-backup: another backup is running" >&2; exit 1; }

PARTIAL=$(mktemp "$OUT_DIR/.partial.XXXXXX")
trap 'rm -f -- "$PARTIAL" "$PARTIAL.gz"' EXIT
compose exec -T postgres pg_dump -U mento -d mento | gzip > "$PARTIAL.gz"
gzip -t "$PARTIAL.gz"
age --encrypt --recipients-file "$RECIPIENTS" --output "$PARTIAL" "$PARTIAL.gz"
rm -f -- "$PARTIAL.gz"
test -s "$PARTIAL"
mv -- "$PARTIAL" "$FILE"
echo "prod-backup: wrote $FILE"

if [ -n "${PROD_BACKUP_REMOTE:-}" ]; then
  rclone copy "$FILE" "$PROD_BACKUP_REMOTE" || { echo "prod-backup: ERROR off-box copy failed" >&2; exit 1; }
  rclone delete "$PROD_BACKUP_REMOTE" --min-age "${OFFSITE_KEEP_DAYS}d" || echo "prod-backup: WARNING remote retention failed" >&2
  echo "prod-backup: copied off-box to $PROD_BACKUP_REMOTE"
else
  echo "prod-backup: WARNING PROD_BACKUP_REMOTE unset; this backup lives only on this box" >&2
fi

find "$OUT_DIR" -maxdepth 1 -name 'mento-prod-*.sql.gz.age' -mtime "+$KEEP_DAYS" -delete
