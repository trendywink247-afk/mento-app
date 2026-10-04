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

The server defaults to `127.0.0.1:18090`; `--port` overrides the port. Container
deployment explicitly uses `--host 0.0.0.0` inside its private network namespace;
the Compose host port is published only on loopback. A separately
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
same store, or establish which snapshots are safe to serve. The API's offline
`reconcile_restored_export` entry point now validates this manifest against an
independently retained checkpoint before transactional replay. It rejects corrupt
checksums, duplicate fields/digests, missing sequences, wrong stores, older exports
and changes to previously witnessed records. The parser accepts at most 100,000
receipts and 32 MiB; larger exports fail closed pending a reviewed capacity change.

`app.services.recovery_manifest.checkpoint_receipt_export` creates a witness from
an export; retain/authenticate it independently of the receiver. Never create a
replacement checkpoint from a suspect export during recovery. Checkpoints and
checksums are not signatures and do not establish sender identity. The operator must
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

## Independently retained checkpoint tooling

`scripts/recovery_receipt_evidence.py` provides offline checkpoint/verification
commands. It does not retrieve data, authenticate a receiver, read private keys,
open an application database or establish deletion coverage. First retrieve a
receiver export through an operator-authenticated procedure (for example pinned
SSH from the accepted independent receiver host). Create a checkpoint only from
that accepted source; never create a fresh checkpoint from a suspect backup.

From the repository root, with input/output in an operator-private directory:

```powershell
& services/api/.venv/Scripts/python.exe scripts/recovery_receipt_evidence.py checkpoint --export PRIVATE_EXPORT.json --output NEW_PRIVATE_CHECKPOINT.json --authenticated-retrieval-confirmed
& services/api/.venv/Scripts/python.exe scripts/recovery_receipt_evidence.py verify --export RECOVERED_EXPORT.json --checkpoint RETAINED_CHECKPOINT.json --trusted-checkpoint-sha256 INDEPENDENTLY_HELD_SHA256
```

The first command publishes a private non-overwriting checkpoint and reports its
SHA-256. Retain that hash independently of the checkpoint/backup and receiver,
using the accepted operator trust/custody channel. The second command checks the
checkpoint against this trust anchor before validating export integrity, store
identity, monotonic sequence and witnessed history. It reports only receipt count
and `coverage: "unverified"`; it never prints member digests. Passing the explicit
retrieval flag is an operator acknowledgement, not cryptographic proof of origin.
Neither a hash supplied alongside an untrusted file nor age encryption alone
authenticates who produced it: anyone knowing the public age recipient can
encrypt different content. Preserve authenticated retrieval and independent
checkpoint custody as separate acceptance evidence.

Operator `verify` and offline reconciliation require a checkpoint whose high-water
mark covers the **entire export**, binding every receipt to the independently held
hash. An older prefix checkpoint cannot authorize appended deletions even when the
export's unkeyed SHA-256 is correct. For a newer legitimate export, retrieve it
through the accepted authenticated source, create a new checkpoint there, and
retain its hash independently before replay. Never create that replacement witness
from a suspect recovered export merely to make verification pass. The lower-level
prefix-continuity mode remains available for structural append checks; it does not
authenticate an unwitnessed suffix and cannot authorize account deletion.

`tests/test_recovery_receipt_drill.py` exercises synthetic stale-row restoration
on the isolated API test database: independently recorded erasure receipts remove
resurrected saved notes, credentials and conversations, preserve another member,
free the mentor seat and reject old refresh reuse without contacting serving
integrations. Run through `scripts/local/api.py test -n 1`, never default pytest
against a serving database. This logical drill does not prove a real PostgreSQL
archive restoration, complete activation/failure coverage or recovery after
losing the primary host. Keep installation, receipt-required flags and backup
scheduling disabled until those additional operational gates pass.

## Container preparation (not installed on either VPS)

Build from this directory's Dockerfile. `deploy/compose.recovery-receiver.yml`
uses a separate project, UID 10001, read-only root, dropped capabilities, a
192 MiB memory cap, 0.5 CPU and loopback-only host publication. Supply an accepted
immutable image, a private credential env file and an existing private data
directory owned by UID 10001. Compose refuses to create a missing host directory.
Do not reuse an application/staging database or a staging-reset volume.

Initialize a new store explicitly with the image's `init --database
/data/receipts.sqlite3` command while mounting only the approved receiver data
directory. Serving deliberately does not initialize it. Capture the store identity
and first export checkpoint through the independent recovery procedure before
accepting application acknowledgements. Keep only public backup recipients here.

`deploy/test-recovery-receiver-container.py IMAGE` exercises the real container
with no host ports and no external network: missing-store refusal, authenticated
commit, forbidden public reads, idempotent retry and persistence after restart.
It removes only its uniquely named synthetic container/volume. Passing this drill
does not establish live TLS, primary-loss coverage or storage-hardware durability.
