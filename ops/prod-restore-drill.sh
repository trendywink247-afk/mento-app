#!/usr/bin/env bash
# Prove the newest encrypted PRODUCTION backup restores (run as root; docker + age).
#
#   prod-restore-drill.sh
#
# Install: infra/prod-root-setup.sh (-> /usr/local/sbin/prod-restore-drill, weekly timer).
# Decrypts the newest archive with this box's backup identity (/etc/mento/age/prod-backup.key,
# root-only; its public half is one of the recipients), restores it into a throwaway Postgres
# with no network and no ports (removed on exit), and checks for tables and an alembic
# revision. Prints PASS or exits non-zero. Never touches the running production stack.
# No archive yet (before the first release) = exits 0 and says so.
set -euo pipefail
umask 077

DIR=${PROD_BACKUP_DIR:-/opt/mento-backups/prod-encrypted}
IDENTITY=${PROD_AGE_IDENTITY:-/etc/mento/age/prod-backup.key}
NAME=mento-prod-drill

[ "$(id -u)" -eq 0 ] || { echo "prod-restore-drill: run as root" >&2; exit 2; }
ARCHIVE=$(find "$DIR" -maxdepth 1 -name 'mento-prod-*.sql.gz.age' -type f 2>/dev/null | sort | tail -1)
[ -n "$ARCHIVE" ] || { echo "prod-restore-drill: no encrypted archive in $DIR yet; nothing to drill"; exit 0; }
[ -r "$IDENTITY" ] || { echo "prod-restore-drill: cannot read the backup identity" >&2; exit 2; }

exec 9>"$DIR/.drill.lock"
flock --nonblock 9 || { echo "prod-restore-drill: another drill is running" >&2; exit 1; }
docker rm -fv "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --network none --memory 768m --cpus 1 \
  -e POSTGRES_USER=drill -e POSTGRES_DB=mento -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16-alpine >/dev/null
trap 'docker rm -fv "$NAME" >/dev/null 2>&1' EXIT

ready=0
for _ in $(seq 1 60); do
  docker exec "$NAME" pg_isready -h 127.0.0.1 -U drill -d mento >/dev/null 2>&1 && { ready=1; break; }
  sleep 1
done
[ "$ready" = 1 ] || { echo "prod-restore-drill: database not ready in 60s" >&2; exit 1; }

# Production's role is `mento`; create it so the dump's ownership statements apply.
docker exec "$NAME" psql -X -q -U drill -d mento -c "CREATE ROLE mento SUPERUSER LOGIN" >/dev/null
age --decrypt -i "$IDENTITY" "$ARCHIVE" | gzip -dc \
  | docker exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U drill -d mento >/dev/null

TABLES=$(docker exec "$NAME" psql -X -At -U drill -d mento -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
REV=$(docker exec "$NAME" psql -X -At -U drill -d mento -c "SELECT version_num FROM alembic_version")
[ "${TABLES:-0}" -gt 0 ] && [ -n "$REV" ] || { echo "prod-restore-drill: FAIL restored empty (tables=$TABLES rev=$REV)" >&2; exit 1; }
echo "prod-restore-drill: PASS $(basename "$ARCHIVE") tables=$TABLES alembic=$REV"
