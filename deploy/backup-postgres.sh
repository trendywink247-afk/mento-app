#!/usr/bin/env bash
# Nightly Postgres backup for the self-managed prod DB (no DO managed PITR here).
# Install as a cron job on the VPS, e.g. crontab -e:
#   0 3 * * * /opt/mento/deploy/backup-postgres.sh >> /var/log/mento-backup.log 2>&1
set -euo pipefail
umask 077

BACKUP_DIR="${MENTO_BACKUP_DIR:-/opt/mento-backups}"
KEEP_DAYS=14
STAMP="$(date +%Y%m%d-%H%M%S-%N)"
FILE="${BACKUP_DIR}/mento-${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

# Keep this inode in place: unlinking a lock file permits another process to
# lock a different inode while the first exporter is still running. Hold the
# descriptor through off-site copy and retention, releasing it on process exit.
exec 9>"${BACKUP_DIR}/.backup.lock"
if ! flock --nonblock 9; then
  echo '[backup] ERROR: another backup holds the archive lock; no work performed' >&2
  exit 1
fi

PARTIAL=$(mktemp "${BACKUP_DIR}/.mento-backup-partial.XXXXXX")
trap 'rm -f -- "$PARTIAL"' EXIT
docker exec mento-postgres-prod pg_dump -U mento mento | gzip > "$PARTIAL"
gzip -t "$PARTIAL"
mv -- "$PARTIAL" "$FILE"
echo "[backup] wrote ${FILE}"

# Off-box copy: VPS B (31.42.125.238), reached over sftp via a dedicated,
# sftp-only key (~/.ssh/backup_to_old) that can't get a shell — set up 2026-09-27,
# see PROGRESS.md. Off-site copies get a longer retention than the local ones
# above, since they're the one thing that survives losing this box entirely.
OFFSITE_KEEP_DAYS=30
if rclone copy "${FILE}" oldbox:/opt/mento-backups/from-new-box/; then
  echo "[backup] copied ${FILE} off-box"
  rclone delete oldbox:/opt/mento-backups/from-new-box/ --min-age "${OFFSITE_KEEP_DAYS}d" || true
else
  echo "[backup] ERROR: off-box copy failed — preserving local backups; remote redundancy unverified" >&2
  exit 1
fi

find "${BACKUP_DIR}" -name 'mento-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
