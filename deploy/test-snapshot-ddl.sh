#!/usr/bin/env bash
# Actual PostgreSQL contention, only synthetic data in an isolated container.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
name="mento-snapshot-$(basename "$temp" | tr '[:upper:]' '[:lower:]')"
created=0
export_pid=''
cleanup() {
  touch "$temp/release"
  if [ -n "$export_pid" ]; then wait "$export_pid" 2>/dev/null || true; fi
  if [ "$created" = 1 ]; then docker rm -fv "$name" >/dev/null; fi
  rm -rf -- "$temp"
}
trap cleanup EXIT
export REAL_DOCKER
REAL_DOCKER=$(command -v docker)
docker run -d --name "$name" --network none --memory 256m --cpus 1 \
  -e POSTGRES_USER=drill -e POSTGRES_DB=source -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
created=1
for _ in $(seq 1 60); do
  if docker exec "$name" pg_isready -h 127.0.0.1 -U drill -d source >/dev/null 2>&1; then break; fi
  sleep 1
done
sql() { docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d source -Atc "$1"; }
sql 'CREATE TABLE chat_messages (id integer, body text) PARTITION BY RANGE(id);
CREATE TABLE renamed_child PARTITION OF chat_messages FOR VALUES FROM (0) TO (10);
CREATE TABLE future_child (LIKE chat_messages);
CREATE TABLE accounts (id integer PRIMARY KEY);
INSERT INTO accounts VALUES (1);
INSERT INTO chat_messages VALUES (1, $$EXCLUDED_SENTINEL$$);' >/dev/null
mkdir "$temp/bin"
# Pause only pg_dump, after exporter snapshot/locks and catalogue discovery.
# All database commands and the eventual dump use the actual Docker binary.
cat > "$temp/bin/docker" <<'WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
if [ "${1:-}" = exec ] && [ "${3:-}" = pg_dump ]; then
  touch "$BARRIER/ready"
  for _ in $(seq 1 300); do
    if [ -e "$BARRIER/release" ]; then
      if [ "${FAIL_DUMP:-0}" = 1 ]; then exit 42; fi
      exec "$REAL_DOCKER" "$@"
    fi
    sleep 0.1
  done
  exit 43
fi
exec "$REAL_DOCKER" "$@"
WRAPPER
chmod +x "$temp/bin/docker"
start_export() {
  rm -f "$temp/ready" "$temp/release"
  PATH="$temp/bin:$PATH" BARRIER="$temp" FAIL_DUMP="$1" \
    bash "$root/deploy/export-recovery-snapshot.sh" "$name" drill source "$temp/$2.gz" &
  export_pid=$!
  for _ in $(seq 1 200); do
    if [ -e "$temp/ready" ]; then return; fi
    kill -0 "$export_pid" 2>/dev/null || { wait "$export_pid"; return 1; }
    sleep 0.1
  done
  echo 'Exporter did not reach locked snapshot barrier' >&2; return 1
}
start_export 0 valid
for ddl in \
  'ALTER TABLE chat_messages ATTACH PARTITION future_child FOR VALUES FROM (10) TO (20)' \
  'ALTER TABLE chat_messages DETACH PARTITION renamed_child' \
  'ALTER TABLE renamed_child RENAME TO escaped_child'; do
  if sql "SET lock_timeout='200ms'; $ddl" >"$temp/ddl.log" 2>&1; then
    echo 'FAIL: partition DDL escaped snapshot lock'; exit 1
  fi
  grep -q 'lock timeout' "$temp/ddl.log"
done
# Normal writes remain available but must not enter the earlier exported snapshot.
sql "SET lock_timeout='1s'; INSERT INTO accounts VALUES (2); INSERT INTO chat_messages VALUES (2, 'EXCLUDED_NEW');" >/dev/null
touch "$temp/release"
wait "$export_pid"; export_pid=''
gzip -t "$temp/valid.gz"
if gzip -dc "$temp/valid.gz" | grep EXCLUDED_; then echo 'FAIL: chat leaked'; exit 1; fi
docker exec "$name" createdb -U drill recovered
gzip -dc "$temp/valid.gz" | docker exec -i "$name" psql -X -v ON_ERROR_STOP=1 -U drill -d recovered >/dev/null
test "$(docker exec "$name" psql -X -At -U drill -d recovered -c 'SELECT count(*) FROM accounts')" = 1
start_export 1 failed
touch "$temp/release"
if wait "$export_pid"; then echo 'FAIL: injected dump failure accepted'; exit 1; fi
export_pid=''
test ! -e "$temp/failed.gz"
test -z "$(find "$temp" -name '.recovery-export.*' -print)"
sql "SET lock_timeout='3s'; ALTER TABLE renamed_child RENAME TO released_child;" >/dev/null
echo 'PASS: partition DDL blocked, writes allowed, snapshot stable, failure unpublished and locks released'
