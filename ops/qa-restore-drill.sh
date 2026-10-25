#!/usr/bin/env bash
# Prove the newest encrypted QA backup restores (run as root; needs docker + age).
#
#   qa-restore-drill.sh
#
# Install (root):  install -o root -g root -m 755 ops/qa-restore-drill.sh /usr/local/sbin/qa-restore-drill
# Schedule:        infra/systemd/mento-qa-restore-drill.{service,timer}  (weekly)
#
# Decrypts the newest archive from /opt/mento-backups/qa-encrypted with the QA server
# identity, restores it into a throwaway postgres container (no network, no published
# ports, removed on exit), then checks that the schema has tables and an alembic
# revision. Prints PASS or exits non-zero. Touches nothing the QA stack uses.
set -euo pipefail
umask 077

DIR="${QA_BACKUP_DIR:-/opt/mento-backups/qa-encrypted}"
IDENTITY="${QA_AGE_IDENTITY:-/etc/mento/age/qa.key}"
NAME="mento-qa-drill-$$"

[ "$(id -u)" -eq 0 ] || { echo "qa-restore-drill: run as root" >&2; exit 2; }
ARCHIVE="$(find "$DIR" -maxdepth 1 -name 'mento-qa-*.sql.gz.age' -type f | sort | tail -1)"
[ -n "$ARCHIVE" ] || { echo "qa-restore-drill: no encrypted archive in $DIR" >&2; exit 1; }
[ -r "$IDENTITY" ] || { echo "qa-restore-drill: cannot read age identity" >&2; exit 2; }

docker run -d --name "$NAME" --network none --memory 512m --cpus 1 \
    -e POSTGRES_USER=mento -e POSTGRES_DB=mento -e POSTGRES_HOST_AUTH_METHOD=trust \
    postgres:16-alpine >/dev/null
trap 'docker rm -fv "$NAME" >/dev/null 2>&1' EXIT

for _ in $(seq 1 60); do
    docker exec "$NAME" pg_isready -h 127.0.0.1 -U mento -d mento >/dev/null 2>&1 && ready=1 && break
    sleep 1
done
[ "${ready:-0}" = 1 ] || { echo "qa-restore-drill: database not ready in 60s" >&2; exit 1; }

# QA's role is mento_staging; create it so ownership statements in the dump apply.
docker exec "$NAME" psql -X -q -U mento -d mento -c "CREATE ROLE mento_staging SUPERUSER LOGIN" >/dev/null
age --decrypt -i "$IDENTITY" "$ARCHIVE" | gzip -dc \
    | docker exec -i "$NAME" psql -X -q -v ON_ERROR_STOP=1 -U mento -d mento >/dev/null

TABLES="$(docker exec "$NAME" psql -X -At -U mento -d mento -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
REV="$(docker exec "$NAME" psql -X -At -U mento -d mento -c "SELECT version_num FROM alembic_version")"
[ "${TABLES:-0}" -gt 0 ] && [ -n "$REV" ] || { echo "qa-restore-drill: FAIL restored empty (tables=$TABLES rev=$REV)" >&2; exit 1; }
echo "qa-restore-drill: PASS $(basename "$ARCHIVE") tables=$TABLES alembic=$REV"
