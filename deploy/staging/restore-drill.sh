#!/usr/bin/env bash
# Read-only input from an existing backup; isolated temporary container, no host ports.
set -euo pipefail
name=mento-restore-drill-$$
backup=$(find /opt/mento-backups/from-new-box -maxdepth 1 -name 'mento-*.sql.gz' -type f | sort | tail -1)
test -n "$backup"
gzip -t "$backup"
docker run -d --name "$name" --network none --memory 256m --cpus 0.5 -e POSTGRES_USER=mento -e POSTGRES_DB=mento -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
trap 'docker rm -fv "$name" >/dev/null' EXIT
ready=0
for i in $(seq 1 60); do
  # The initialization server listens on a Unix socket and then shuts down.
  # TCP readiness identifies the final server, avoiding restore during restart.
  if docker exec "$name" pg_isready -h 127.0.0.1 -U mento -d mento >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo 'Restore database did not become TCP-ready within 60 seconds' >&2
  exit 1
fi
gzip -dc "$backup" | docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U mento -d mento >/dev/null
printf 'Restored archive: %s\n' "$(basename "$backup")"
docker exec "$name" psql -X -At -U mento -d mento -c 'SELECT version_num FROM alembic_version;'
docker run --rm --network "container:$name" --memory 256m --cpus 0.5 -e DATABASE_URL=postgresql+psycopg://mento@127.0.0.1:5432/mento "${RESTORE_IMAGE:-mento-api:staging-6e47f7a}" alembic upgrade head
docker exec "$name" psql -X -At -U mento -d mento -c 'SELECT version_num FROM alembic_version;'
echo 'PASS: isolated restore and forward migration; no serving application attached'
