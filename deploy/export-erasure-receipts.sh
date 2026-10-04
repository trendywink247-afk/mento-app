#!/usr/bin/env bash
# Export receipt digests only, for encryption/replication by the recovery operator.
# A point-in-time manifest is NOT proof of delivery of all later deletions.
set -euo pipefail
umask 077
container=${1:?container required}; user=${2:?database user required}
database=${3:?database required}; destination=${4:?new gzip manifest required}
test ! -e "$destination" && test ! -L "$destination"
partial=$(mktemp "$(dirname "$destination")/.erasure-receipts.XXXXXX")
trap 'rm -f -- "$partial"' EXIT
# One SQL statement uses one MVCC snapshot; no raw member identity or content.
timeout 60 docker exec "$container" psql -X -qAt -v ON_ERROR_STOP=1 -U "$user" -d "$database" -c \
  "SELECT json_build_object('version', 1, 'exported_at', statement_timestamp(), 'receipts', COALESCE(json_agg(member_digest ORDER BY member_digest), '[]'::json)) FROM erasure_receipts;" | gzip > "$partial"
gzip -t "$partial"
# Same-directory hard link gives non-overwriting publication, including races.
ln -- "$partial" "$destination"
echo 'Receipt manifest exported; encryption, replication and coverage acceptance still required'
