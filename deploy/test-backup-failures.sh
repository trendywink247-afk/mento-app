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
echo dump >> "$BACKUP_TEST_LOG"
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
# A concurrent invocation must stop before export, copy or retention. The real
# kernel lock is exercised; only Docker and the remote-copy command are fakes.
exec 8>"$MENTO_BACKUP_DIR/.backup.lock"
flock --nonblock 8
if bash "$root/deploy/backup-postgres.sh"; then echo 'FAIL: concurrent backup accepted'; exit 1; fi
test ! -e "$BACKUP_TEST_LOG"
flock --unlock 8
exec 8>&-
export BACKUP_TEST_MODE=dump-failure
if bash "$root/deploy/backup-postgres.sh"; then echo 'FAIL: dump failure accepted'; exit 1; fi
test -z "$(find "$MENTO_BACKUP_DIR" -type f ! -name '.backup.lock' -print)"
test "$(cat "$BACKUP_TEST_LOG")" = dump
: > "$BACKUP_TEST_LOG"
export BACKUP_TEST_MODE=copy-failure
if bash "$root/deploy/backup-postgres.sh"; then echo 'FAIL: failed remote copy accepted'; exit 1; fi
test "$(cat "$BACKUP_TEST_LOG")" = $'dump\ncopy'
archive=$(find "$MENTO_BACKUP_DIR" -name '*.sql.gz' -type f)
test -n "$archive"
gzip -t "$archive"
test "$(stat -c '%a' "$archive")" = 600
test "$(gzip -dc "$archive")" = 'synthetic SQL'
# Both failures released the lock. A later run must export, copy and only then
# invoke remote retention successfully.
: > "$BACKUP_TEST_LOG"
export BACKUP_TEST_MODE=success
bash "$root/deploy/backup-postgres.sh"
test "$(cat "$BACKUP_TEST_LOG")" = $'dump\ncopy\ndelete'
echo 'PASS: overlap refused; lock released after failure; partial dump removed; copy precedes retention'
