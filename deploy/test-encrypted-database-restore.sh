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
docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d source >/dev/null <<'SQL'
CREATE TABLE accounts (id integer PRIMARY KEY, display_name text NOT NULL);
CREATE TABLE memberships (account_id integer REFERENCES accounts(id), community text NOT NULL);
INSERT INTO accounts VALUES (1, 'Synthetic mentor'), (2, 'Synthetic mentee');
INSERT INTO memberships VALUES (1, 'UPSC'), (2, 'NEET');
SQL
docker exec "$name" pg_dump -U drill -d source | gzip > "$temp/source.sql.gz"
age-keygen -o "$temp/identity" >/dev/null 2>&1
age-keygen -y "$temp/identity" > "$temp/recipients"
bash "$root/deploy/encrypt-backup.sh" "$temp/source.sql.gz" "$temp/recipients" "$temp/archive.age"
bash "$root/deploy/decrypt-backup.sh" "$temp/archive.age" "$temp/identity" "$temp/recovered.sql.gz"
docker exec "$name" createdb -U drill recovered
gzip -dc "$temp/recovered.sql.gz" | docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered >/dev/null
result=$(docker exec "$name" psql -X -At -U drill -d recovered -c 'SELECT count(*) FROM accounts JOIN memberships ON id=account_id;')
test "$result" = 2
if docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered \
  -c "INSERT INTO memberships VALUES (999, 'invalid');" >/dev/null 2>&1; then
  echo 'FAIL: restored foreign key was not enforced'; exit 1
fi
echo 'PASS: synthetic encrypted PostgreSQL restore preserves rows and foreign-key enforcement'
