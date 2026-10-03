#!/usr/bin/env bash
# Isolated command fakes; never accesses Docker, SFTP or real backup directories.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
trap 'rm -rf -- "$temp"' EXIT
mkdir "$temp/bin" "$temp/backups"
export MENTO_BACKUP_DIR="$temp/backups" BACKUP_TEST_LOG="$temp/commands"
cat > "$temp/bin/docker" <<'DOCKER'
#!/usr/bin/env bash
echo 'synthetic SQL'
test "${BACKUP_TEST_MODE:-}" != dump-failure
DOCKER
cat > "$temp/bin/rclone" <<'RCLONE'
#!/usr/bin/env bash
echo "$1" >> "$BACKUP_TEST_LOG"
test "${BACKUP_TEST_MODE:-}" != copy-failure
RCLONE
chmod +x "$temp/bin/"*
export PATH="$temp/bin:$PATH"
export BACKUP_TEST_MODE=dump-failure
if bash "$root/deploy/backup-postgres.sh"; then echo 'FAIL: dump failure accepted'; exit 1; fi
test -z "$(find "$MENTO_BACKUP_DIR" -type f -print)"
test ! -e "$BACKUP_TEST_LOG"
export BACKUP_TEST_MODE=copy-failure
if bash "$root/deploy/backup-postgres.sh"; then echo 'FAIL: failed remote copy accepted'; exit 1; fi
test "$(cat "$BACKUP_TEST_LOG")" = copy
archive=$(find "$MENTO_BACKUP_DIR" -name '*.sql.gz' -type f)
test -n "$archive"
gzip -t "$archive"
test "$(stat -c '%a' "$archive")" = 600
test "$(gzip -dc "$archive")" = 'synthetic SQL'
echo 'PASS: partial dump removed, off-box failure reported, private local archive retained without pruning'
