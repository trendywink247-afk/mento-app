# Local same-database topology rehearsal

`deploy/rehearse-same-database.py` exercises classic → two API colours plus worker →
classic against one disposable PostgreSQL 16 database and volume. Both topologies
use the **same candidate image**. This proves retained-data behaviour across runtime
topology changes; it does not prove compatibility with an older production image.
No VPS, DNS, deployment flags, reverse proxy or existing workspace database changes.

Build the desired accepted candidate from its isolated checkout, with its full Git
SHA as the image label. Use a unique local image tag; never use production tags:

```powershell
$revision = git rev-parse HEAD
$tag = "mento-local-rehearsal:$([guid]::NewGuid().ToString('N'))"
docker build --label "org.opencontainers.image.revision=$revision" --label org.mento.release.variant=local-rehearsal-never-promote -t $tag services/api
python deploy/rehearse-same-database.py --image $tag --revision $revision
```

The script requires Python 3.12, a reachable **local** Docker Unix socket or Windows
named-pipe context, and locally available `postgres:16-alpine`,
`valkey/valkey:8-alpine` and candidate API images. It never pulls images. If needed,
obtain base images separately before running. `--context` chooses another local
context; remote Docker endpoints are refused. Python optimization is refused because
proof assertions must stay enabled. API settings use synthetic credentials, dev
Stream stubs, disabled pushes and disabled required recovery receipts.

The proof covers actual Alembic initialization, real onboarding and journal writes,
live authoritative-cluster/inventory/pool preflight, wrong-cluster and new-endpoint
refusal, insufficient old/new connection-overlap capacity, committed maintenance-job
consumption by the sole worker, API account erasure, and preservation of both writes
and deletion after restarting the classic topology. An additive synthetic table
also survives rollback. It is not a release-specific migration compatibility test,
proxy traffic-switch test, production performance benchmark or operational acceptance.
Candidate preflight models this synthetic topology, rather than a full rendered
production Compose deployment; production must still pass its own locked preparation.

Every runtime name and owner label includes a UUID. API ports are ephemeral and
bound only to `127.0.0.1`; all containers have CPU, memory and PID limits. Candidate
and base images are pinned to their inspected immutable image IDs before running.
Cleanup requires the exact run label and recorded container/network ID or volume
creation timestamp, then verifies the owned-resource inventories are empty. It
never prunes or deletes a resource by name alone. A Docker command timeout that
created an owned resource still records its inspected identity for cleanup.

Evidence defaults to `.local/mento-rehearsal-<uuid>.json`; `--evidence` selects another
path. Exit status is nonzero for failed checks or incomplete cleanup. JSON records
checks, conservative pool budget, candidate identity, limitations and cleanup; it
does not contain API tokens, database URLs or command stderr. On interrupted or
unreachable-Docker runs, inspect resources with the exact owner label recorded in
the evidence, verify their identities, and remove only those resources. Images are
operator-created artifacts and are retained; remove only the unique local tag after
reviewing the proof. No production image tag should point to this rehearsal build.

Fast safety tests, without Docker or database access:

```powershell
python -m unittest discover -s scripts/ci -p test_same_database_rehearsal.py
```
