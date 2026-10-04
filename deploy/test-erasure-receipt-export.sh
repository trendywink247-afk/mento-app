#!/usr/bin/env bash
# Disposable network-isolated manifest drill: no serving DB or real identities.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
temp=$(mktemp -d)
name="mento-receipt-drill-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf -- "$temp"; }
trap cleanup EXIT
docker run -d --name "$name" --network none --memory 256m --cpus 1 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null
for i in {1..30}; do docker exec "$name" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -c 'CREATE TABLE erasure_receipts(member_digest varchar(64) PRIMARY KEY);' >/dev/null
bash "$root/deploy/export-erasure-receipts.sh" "$name" postgres postgres "$temp/empty.gz"
python3 - "$temp/empty.gz" <<'PY'
import gzip, json, sys
with gzip.open(sys.argv[1], 'rt') as f: data = json.load(f)
assert data['version'] == 1 and data['receipts'] == [] and data['exported_at']
PY
docker exec "$name" psql -X -v ON_ERROR_STOP=1 -U postgres -c "INSERT INTO erasure_receipts VALUES (repeat('b',64)), (repeat('a',64));" >/dev/null
bash "$root/deploy/export-erasure-receipts.sh" "$name" postgres postgres "$temp/receipts.gz"
python3 - "$temp/receipts.gz" <<'PY'
import gzip, json, sys
with gzip.open(sys.argv[1], 'rt') as f: data = json.load(f)
assert data['receipts'] == ['a'*64, 'b'*64]
assert set(data) == {'version', 'exported_at', 'receipts'}
PY
test "$(stat -c '%a' "$temp/receipts.gz")" = 600
before=$(sha256sum "$temp/receipts.gz")
if bash "$root/deploy/export-erasure-receipts.sh" "$name" postgres postgres "$temp/receipts.gz"; then exit 1; fi
test "$before" = "$(sha256sum "$temp/receipts.gz")"
if bash "$root/deploy/export-erasure-receipts.sh" "$name" postgres missing "$temp/failed.gz"; then exit 1; fi
test ! -e "$temp/failed.gz"
test -z "$(find "$temp" -name '.erasure-receipts.*' -print)"
echo 'PASS: receipt manifest empty/populated export, private permissions, overwrite refusal and failure cleanup'
