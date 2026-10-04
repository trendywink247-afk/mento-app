# Independent recovery receipt receiver — local candidate

This separate service accepts pseudonymous member-erasure digests. It is not part
of the main API, does not use the staging application database, and has no live
deployment or completed recovery coverage. The API acknowledgement gate stays off
until receiver installation and the end-to-end recovery gates are accepted.

`POST /receipts` accepts exactly `{"version":1,"member_digest":"<64 lowercase hex>"}`
with a dedicated `Authorization: Bearer ...` credential. It commits to SQLite before
returning the matching `{"version":1,"member_digest":"...","durable":true}`.
Retries preserve the first receipt and timestamp. Unavailable storage returns 503;
malformed/oversized/unauthorized requests cannot write. Request bodies are bounded
to 256 bytes, including chunked bodies, with a five-second body-read deadline.
Application code does not log credentials, digests, bodies or storage exceptions.

SQLite uses WAL and `synchronous=FULL` on each connection. Each operation opens its
own connection; write transactions serialize duplicate checks and insertion. The
service refuses to create a missing database and pins the initialized store ID
for its lifetime. There is no deletion, update, list or export HTTP endpoint.

## Local commands

Use Python 3.12 and the pinned requirements. Existing API development dependencies
already contain the dependencies needed for local tests; no main API module or
configuration is loaded. From the repository root in PowerShell:

```powershell
& services/api/.venv/Scripts/python.exe -m pytest -c services/recovery_receiver/pyproject.toml services/recovery_receiver/tests -q
& services/api/.venv/Scripts/ruff.exe check services/recovery_receiver
& services/api/.venv/Scripts/ruff.exe format --check services/recovery_receiver
```

Provision a private directory first. Run the module with `services` as the working
directory. These examples are operator recipes, not changes to a live host:

```sh
python -m recovery_receiver init --database /private/receiver/receipts.sqlite3
# Inject RECEIVER_TOKEN securely; do not put the token in process arguments.
python -m recovery_receiver serve --database /private/receiver/receipts.sqlite3
python -m recovery_receiver export --database /private/receiver/receipts.sqlite3 --output /private/receiver/export-NEW.json
```

The server binds only `127.0.0.1:18090`; `--port` overrides the port. A separately
accepted HTTPS edge must expose `/receipts`, limit body/header size, preserve the
authorization header, and avoid logging headers/bodies. No TLS certificate or edge
route is installed here. `RECEIVER_PREVIOUS_TOKEN` optionally permits one previous
credential during explicit rotation; remove it after both production colors use
the new credential. Credentials are 32–256 printable non-space ASCII characters.

## Export contract and coverage

Only a local operator with filesystem access can export. One SQLite read snapshot
produces store ID, creation/export timestamps, ordered receipt records, count and
high-water sequence. `sha256` hashes UTF-8 canonical JSON of the other manifest
fields (`sort_keys=True`, compact separators, ASCII escaping). It detects accidental
corruption; it is not authentication. Export publication uses a private temporary
file, fsync, and a same-directory non-overwriting hard link. Encrypt/authenticate
the manifest with the recovery recipient before transfer. Do not treat plaintext
exports as ordinary logs or publish them with build artifacts.

Every export explicitly says `coverage: "unverified"`. A fresh store cannot know
deletions that happened before activation. A count/high-water value alone cannot
prove a complete history, detect replacing the database with an older copy of the
same store, or establish which snapshots are safe to serve. Existing API replay
does not yet consume or verify this manifest automatically. The operator must
establish store identity, backfill, activation boundary, accepted backup baseline,
and independently witnessed export watermarks before recovery is opened to traffic.

## Operational acceptance still required

- Install on B with a dedicated service identity, private persistent **local** disk
  volume, resource limits and storage that honors fsync; keep it outside staging
  rebuild/reset lifecycle. SQLite WAL is not suitable on a network filesystem.
- Verify HTTPS/authentication, credential rotation, denied public reads, host/disk
  failure alerts and space headroom. Limit request concurrency at the accepted edge.
- Establish deletion coverage across activation and application rollback. Quiesce
  erasure while backfilling and switching every production instance to the required
  acknowledgement gate; an old binary can otherwise acknowledge an unrecorded erase.
  Historical snapshots with missing deletion coverage remain ineligible for traffic.
- Independently encrypt/copy receipts, prove recovery with external keys, and restore
  an old encrypted application snapshot after losing its primary. Reconcile the
  independently recovered complete receipt set before API/workers/outbound delivery.
- Receipts have no automatic retention/pruning. Keep them at least until every
  snapshot capable of resurrecting the member has expired and expiry is verified.
  Reconcile public disclosures before activation; these digests are pseudonymous.

Tests use synthetic temporary SQLite files only, including an abrupt subprocess
exit immediately after commit, retry/reopen, failed writes/commits, concurrency,
request rejection and consistent exports. They do not simulate host power loss,
lying storage hardware, corruption recovery, loss of both VPSes, throughput limits,
or completed primary-loss recovery. Windows tests also do not establish Linux
directory-fsync behavior; the target Linux host still needs acceptance.
