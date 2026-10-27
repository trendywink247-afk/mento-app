#!/usr/bin/env bash
# Encrypted nightly backup of the QA Postgres (run as root; needs docker).
#
#   qa-backup.sh
#
# Install (root):  install -o root -g root -m 755 ops/qa-backup.sh /usr/local/sbin/qa-backup
# Schedule:        infra/systemd/mento-qa-backup.{service,timer}
#
# pg_dump (through the mento-staging compose project) -> gzip -t -> age-encrypt to the
# PUBLIC recipients in /etc/mento/age/qa.recipients -> plaintext is never left on disk.
# Output: /opt/mento-backups/qa-encrypted/mento-qa-<stamp>.sql.gz.age (0600).
# Off-box: if QA_BACKUP_REMOTE is set (an rclone destination, e.g. offbox:mento-qa/) the
# archive is copied there and a failed copy fails the run. Unset means local only, and
# the script says so loudly.
# Retention: KEEP_DAYS local (14), OFFSITE_KEEP_DAYS remote (30).
# The older plaintext job writing /opt/mento-backups/mento-*.sql.gz is NOT touched here;
# retire it once the first encrypted archive has passed qa-restore-drill.
set -euo pipefail
umask 077

COMPOSE=/opt/mento-staging/compose.yml
RECIPIENTS="${QA_AGE_RECIPIENTS:-/etc/mento/age/qa.recipients}"
OUT_DIR="${QA_BACKUP_DIR:-/opt/mento-backups/qa-encrypted}"
KEEP_DAYS=14
OFFSITE_KEEP_DAYS=30
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUT_DIR/mento-qa-$STAMP.sql.gz.age"

[ "$(id -u)" -eq 0 ] || { echo "qa-backup: run as root" >&2; exit 2; }
[ -s "$RECIPIENTS" ] || { echo "qa-backup: no age recipients at $RECIPIENTS" >&2; exit 2; }
command -v age >/dev/null || { echo "qa-backup: age not installed" >&2; exit 2; }
mkdir -p "$OUT_DIR"

exec 9>"$OUT_DIR/.backup.lock"
flock --nonblock 9 || { echo "qa-backup: another backup is running" >&2; exit 1; }

PARTIAL="$(mktemp "$OUT_DIR/.partial.XXXXXX")"
trap 'rm -f -- "$PARTIAL"' EXIT

docker compose -f "$COMPOSE" exec -T postgres pg_dump -U mento_staging -d mento_staging \
    | gzip > "$PARTIAL.gz"
gzip -t "$PARTIAL.gz"
age --encrypt --recipients-file "$RECIPIENTS" --output "$PARTIAL" "$PARTIAL.gz"
rm -f -- "$PARTIAL.gz"
test -s "$PARTIAL"
mv -- "$PARTIAL" "$FILE"
echo "qa-backup: wrote $FILE"

if [ -n "${QA_BACKUP_REMOTE:-}" ]; then
    rclone copy "$FILE" "$QA_BACKUP_REMOTE" || { echo "qa-backup: ERROR off-box copy failed" >&2; exit 1; }
    rclone delete "$QA_BACKUP_REMOTE" --min-age "${OFFSITE_KEEP_DAYS}d" || echo "qa-backup: WARNING remote retention failed" >&2
    echo "qa-backup: copied off-box to $QA_BACKUP_REMOTE"
else
    echo "qa-backup: WARNING QA_BACKUP_REMOTE unset; this backup lives only on this box" >&2
fi

find "$OUT_DIR" -name 'mento-qa-*.sql.gz.age' -mtime "+$KEEP_DAYS" -delete
