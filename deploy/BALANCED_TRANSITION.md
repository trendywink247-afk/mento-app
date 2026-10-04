# Same-authoritative-database transition preparation

This package is a read-only planning preflight and a rendered configuration, not
a live cutover command. **Do not run the current `deploy.sh` with this override**:
that script explicitly starts `postgres`, which bypasses Compose profile exclusion.
The classic production receiver remains unchanged. Activation needs separate
reviewed orchestration that never creates/restarts the authoritative database or
cache, never mounts its volume into another engine, and reruns this identity guard
under the deployment lock immediately before migration/swap.

The 5 October read-only inventory found production on the classic API with two
Uvicorn processes, effective per-process pools 5+5, no worker, PostgreSQL limit
100 and three superuser reserved slots. Database/cache use `deploy_default`;
database volume is `deploy_mento_pgdata_prod`. B's historical services use the same
textual network/volume names with different identities. Names alone cannot prove
the correct host/cluster. No live IDs, credentials or URLs are recorded here.

Prepare protected, untracked expected-identity JSON on the target host:

```json
{
  "database_container": "mento-postgres-prod",
  "container_id": "<64 lowercase hex from trusted inventory>",
  "database_name": "mento",
  "database_user": "mento",
  "system_identifier": "<decimal pg_control_system identifier>",
  "database_oid": 16384,
  "network": "deploy_default",
  "network_id": "<64 lowercase hex from trusted inventory>",
  "volume": "deploy_mento_pgdata_prod",
  "cache_container": "mento-redis-prod",
  "cache_id": "<64 lowercase hex from trusted inventory>",
  "old_clients": ["mento-api-prod"],
  "other_clients": []
}
```

Values must come from a trusted serving-host inventory. Do not regenerate an
expected identity automatically from whichever database happens to be running.
A changed container identity requires explicit investigation; recreating an
expected manifest merely to make a failed guard pass defeats the guard.

Supply the authoritative DB URL, existing cache URL and verified network using
protected operator configuration (`MENTO_AUTHORITATIVE_DATABASE_URL`,
`MENTO_AUTHORITATIVE_REDIS_URL`, `MENTO_AUTHORITATIVE_NETWORK`). DB host must be the
unique retained container name, not the ambiguous `postgres` service alias. Cache
host must be the retained cache container, index 0, preserving existing rate-limit
state. Credentials must remain outside Git and logs. Compose 2.24.4+ is needed for
the override/reset tags. Render base + prod + transition override using only
`green` and `tools` profiles into a protected temporary JSON file; never print the
rendered file. The unmanaged postgres/valkey/GlitchTip services must be excluded.

Run `python3 deploy/transition-preflight.py --expected <protected-manifest>
--candidate-config <protected-rendered-json> --headroom 5 --other-connections 0`
on the target host. Its reviewed bundle also needs `scripts/ci/database_budget.py`
and `effective_database_budget.py`. The preflight only inspects running containers
and performs database SELECT/SHOW queries. It emits aggregate counts or a generic
failure; subprocess error details and environment values remain private.

The guard requires the expected container, volume, network, cluster identifier and
database OID; verifies each old API/worker's effective engine pool and server
identity; rejects unseen same-network DB clients and conflicting DNS aliases; and
validates the candidate's DB/cache endpoints, commands, dependencies and networks.
It budgets **all existing application pools plus both desired API colors, the
desired worker and queue connector, one migration connection, actual server
reserved slots, explicit auxiliary-client allowance and operational headroom**.
The inspected classic baseline plus current desired core requires 58/100; that
same overlap fails at 50. This is a connection ceiling, not observed workload or
permission to reduce/reconfigure the serving database.

`other_clients` names any reviewed same-network auxiliary database clients;
`--other-connections` must bound those plus out-of-network/host tools. The guard
cannot discover every external connection source, privileged ad-hoc client,
alternate DSN environment name or embedded configuration. Audit these separately
and supply a finite aggregate allowance. Missing/nonstandard process or queue-pool
bounds fail closed; do not infer them from old image defaults. The new worker
connector bound is four in the currently reviewed source; re-review it for a changed
candidate image. The guard does not authenticate the new candidate credentials or
exercise migrations; candidate-image DB connectivity and compatible schema must
be proven in isolated acceptance before activation.

Remaining activation gates: immutable artifact provenance; compatible forward
migration and old-client rollback; authoritative writer inventory and one periodic
scheduler; real old/new memory/CPU/load tests; production HTTPS/cert renewal and
authenticated WebSocket behavior; safe Nginx/Caddy edge ownership; synthetic
committed writes and erasures surviving edge rollback; delivered alerts and tested
recovery; topology-aware receiver verification. A passing planning preflight never
unlocks production, starts a container or replaces these gates.

## Locked preparation and explicit runtime topology

`prepare-transition.py` uses the same `deploy.lock` as the existing deployment
script, refuses a contending invocation, checks the loaded image's full revision
label and exact runtime image ID, checks all four candidate service image tags,
and runs the identity/inventory/budget preflight while holding that lock. It emits
an allowlisted ordered plan with `activation_authorized:false`. It never runs
Compose up/run, migrations, edge reloads or service shutdowns. Do not treat the
returned plan as an activation approval or durable evidence that the environment
will remain unchanged; rerun under the lock immediately before any later action.

Supply `--expected`, `--candidate-config`, `--release`, `--state-dir`, `--headroom`
and `--other-connections`. The release document uses
`{"sha":"<full accepted SHA>","runtime_image_id":"sha256:<64 lowercase hex>"}`.
The runtime image ID is the reviewed **loaded Docker representation**, which may
differ from the build manifest's image representation; never assume equivalence.
Tie this record to successful exact-commit checks and accepted staging provenance
before operational use. The tool checks the record against the loaded image, but
does not independently certify GitHub or operational acceptance.

`verify-transition-runtime.py` is an independent, read-only verifier; the installed
classic receiver is not changed. Supply `--expected`, `--release`, `--roles` and
the same `--state-dir`. A roles document explicitly maps colors and worker to their
actual container names, for example
`{"api_green":"<new API container>","worker":"<new worker container>"}`.
It holds the deployment lock, verifies retained data-service identities and all
known DB clients, rejects multiple live worker processes/periodic schedulers, and
checks supplied roles against the accepted runtime image, DB identity, API health,
worker command and queue heartbeat. Keep expected `old_clients` accurate for any
baseline processes still running; changing this list does not change the retained
DB/cache identity. Unexpected writers fail closed.

Its `production_acceptance:false` result is deliberate: a database-global fresh
heartbeat can reflect a recently retired worker, and these SELECTs do not prove
committed job execution, delivered alerts, edge routing, public TLS or message
delivery. Require separate execution and operational acceptance. Future replica
topologies need per-worker identity and scheduling ownership rather than relaxing
the single-worker check.
