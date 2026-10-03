#!/usr/bin/env bash
# Synthetic PostgreSQL dump -> age -> validated decrypt -> separate database.
# No host ports, serving database, VPS connection or persistent recovery key.
set -euo pipefail
umask 077
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
name="mento-encrypted-drill-$(basename "$temp" | tr '[:upper:]' '[:lower:]')"
created=0
cleanup() {
  if [ "$created" = 1 ]; then docker rm -fv "$name" >/dev/null; fi
  rm -rf -- "$temp"
}
trap cleanup EXIT
docker run -d --name "$name" --network none --memory 256m --cpus 1 \
  -e POSTGRES_USER=drill -e POSTGRES_DB=source -e POSTGRES_HOST_AUTH_METHOD=trust \
  postgres:16-alpine >/dev/null
created=1
ready=0
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U drill -d source >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
test "$ready" = 1
if [ -n "${RESTORE_IMAGE:-}" ]; then
  docker run --rm --network "container:$name" --memory 256m \
    -e ENV=dev -e DATABASE_URL=postgresql+psycopg://drill@127.0.0.1:5432/source \
    "$RESTORE_IMAGE" alembic upgrade head
  revision=$(docker exec "$name" psql -X -At -U drill -d source -c 'SELECT version_num FROM alembic_version;')
  test -n "$revision"
fi
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d source >/dev/null <<'SQL'
CREATE TABLE drill_accounts (id integer PRIMARY KEY, display_name text NOT NULL);
CREATE TABLE drill_memberships (account_id integer REFERENCES drill_accounts(id), community text NOT NULL);
INSERT INTO drill_accounts VALUES (1, 'Synthetic mentor'), (2, 'Synthetic mentee');
INSERT INTO drill_memberships VALUES (1, 'UPSC'), (2, 'NEET');
-- Synthetic only: prove discovery follows descendants, not a naming convention.
CREATE TABLE drill_messages (period integer NOT NULL, body text) PARTITION BY RANGE (period);
CREATE TABLE drill_messages_current PARTITION OF drill_messages FOR VALUES FROM (0) TO (10);
CREATE TABLE renamed_future_partition PARTITION OF drill_messages FOR VALUES FROM (10) TO (20);
CREATE TABLE drill_messages_default PARTITION OF drill_messages DEFAULT;
INSERT INTO drill_messages VALUES (1, 'EXCLUDED_SENTINEL_CURRENT'),
 (11, 'EXCLUDED_SENTINEL_FUTURE'), (99, 'EXCLUDED_SENTINEL_DEFAULT');
SQL
# This is a drill, not a production exporter: concurrent partition DDL/snapshot
# coordination and saved-note/report policies still need separate acceptance.
docker exec "$name" psql -X -At -U drill -d source -c \
  "SELECT format('%I.%I', n.nspname, c.relname) FROM pg_partition_tree('public.drill_messages') p JOIN pg_class c ON c.oid=p.relid JOIN pg_namespace n ON n.oid=c.relnamespace ORDER BY c.oid;" > "$temp/exclusions"
test "$(wc -l < "$temp/exclusions")" -eq 4
exclusions=()
while IFS= read -r relation; do
  exclusions+=("--exclude-table-data=$relation")
done < "$temp/exclusions"
docker exec "$name" pg_dump -U drill -d source "${exclusions[@]}" | gzip > "$temp/source.sql.gz"
if gzip -dc "$temp/source.sql.gz" | grep 'EXCLUDED_SENTINEL'; then
  echo 'FAIL: message sentinel leaked into dump'; exit 1
fi
age-keygen -o "$temp/identity" >/dev/null 2>&1
age-keygen -y "$temp/identity" > "$temp/recipients"
bash "$root/deploy/encrypt-backup.sh" "$temp/source.sql.gz" "$temp/recipients" "$temp/archive.age"
bash "$root/deploy/decrypt-backup.sh" "$temp/archive.age" "$temp/identity" "$temp/recovered.sql.gz"
docker exec "$name" createdb -U drill recovered
gzip -dc "$temp/recovered.sql.gz" | docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered >/dev/null
result=$(docker exec "$name" psql -X -At -U drill -d recovered -c 'SELECT count(*) FROM drill_accounts JOIN drill_memberships ON id=account_id;')
test "$result" = 2
test "$(docker exec "$name" psql -X -At -U drill -d recovered -c 'SELECT count(*) FROM drill_messages;')" = 0
test "$(docker exec "$name" psql -X -At -U drill -d recovered -c "SELECT count(*) FROM pg_partition_tree('public.drill_messages');")" = 4
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered \
  -c "INSERT INTO drill_messages VALUES (11, 'new after recovery');" >/dev/null
test "$(docker exec "$name" psql -X -At -U drill -d recovered -c 'SELECT count(*) FROM renamed_future_partition;')" = 1
echo 'PASS: excluded partition data absent; partition schema and routing preserved'
if docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered \
  -c "INSERT INTO drill_memberships VALUES (999, 'invalid');" >/dev/null 2>&1; then
  echo 'FAIL: restored foreign key was not enforced'; exit 1
fi
if [ -n "${RESTORE_IMAGE:-}" ]; then
  recovered_revision=$(docker exec "$name" psql -X -At -U drill -d recovered -c 'SELECT version_num FROM alembic_version;')
  test "$revision" = "$recovered_revision"
  # Remove only synthetic drill tables before comparing application metadata.
  docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered \
    -c 'DROP TABLE drill_memberships; DROP TABLE drill_accounts; DROP TABLE drill_messages CASCADE;' >/dev/null
  docker run --rm --network "container:$name" --memory 256m \
    -e ENV=dev -e DATABASE_URL=postgresql+psycopg://drill@127.0.0.1:5432/recovered \
    "$RESTORE_IMAGE" alembic check
  echo 'PASS: restored Mento migration revision and schema match the application image'
fi
echo 'PASS: synthetic encrypted PostgreSQL restore preserves rows and foreign-key enforcement'
