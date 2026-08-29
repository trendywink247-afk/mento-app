#!/usr/bin/env bash
# Nightly Postgres backup for the self-managed prod DB (no DO managed PITR here).
# Install as a cron job on the VPS, e.g. crontab -e:
#   0 3 * * * /opt/mento/deploy/backup-postgres.sh >> /var/log/mento-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="/opt/mento-backups"
KEEP_DAYS=14
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="${BACKUP_DIR}/mento-${STAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

docker exec mento-postgres-prod pg_dump -U mento mento | gzip > "${FILE}"
echo "[backup] wrote ${FILE}"

# Off-box copy: uncomment and configure once rclone is set up (Backblaze B2 / S3 / etc.)
# rclone copy "${FILE}" remote:mento-backups/

find "${BACKUP_DIR}" -name 'mento-*.sql.gz' -mtime "+${KEEP_DAYS}" -delete
