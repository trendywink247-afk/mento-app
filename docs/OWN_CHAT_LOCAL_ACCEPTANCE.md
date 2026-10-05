# Own-chat local replica and process-loss proof

`deploy/rehearse-own-chat.py` uses the ownership, local-context, immutable-image and
cleanup controls from `rehearse-same-database.py`. It creates two API replicas with
one Uvicorn process each, one PostgreSQL 16 database and one Valkey 8 cache. All names
and labels contain a UUID; API ports are ephemeral loopback bindings. No workspace
database, VPS, DNS, feature flag or deployment is changed. Build a uniquely tagged
API image with the full revision label as documented in `SAME_DATABASE_REHEARSAL.md`.

```powershell
python deploy/rehearse-own-chat.py --image $tag --revision $revision
```

Python 3.12, `websockets` with `websockets.asyncio.client` support, local Docker and the
three locally available images are required. API runtime dependencies from
`services/api/requirements.txt` include WebSocket support. No images are pulled.
`--context` selects a local socket context. `--evidence` selects the JSON artifact.

The default modest workload uses three synthetic rooms, six sockets and ten messages
per room, with at most three sends in flight. Each member uses API A and each mentor
API B. Each room then runs ten authenticated REST history reads. `--rooms` permits
1–4 and `--messages` 1–15; these bounds remain below the default per-person frame
budget during the following fault probes. Bodies are identical synthetic greetings;
tokens and message contents are not written to the evidence. Stream is stubbed,
pushes disabled, and all accounts are disposable synthetic seeds. Default product
rate limits and the currently disabled allowance-enforcement switch are retained.

Measure separately: send to sender's persisted echo, send to the other replica's
socket arrival, and authenticated HTTP history latency. JSON reports sample counts,
nearest-rank p50/p95/max, measured phase duration, workload size, per-container memory/
CPU/PID limits and host/Docker resource context. Cold initialization and deliberate
faults are excluded from steady-workload percentiles; reconnect timing is separate.
Project targets are chat delivery p95 <500 ms, API p95 <300 ms and reconnect <3 s.
These local numbers do not establish production capacity or justify extrapolation.
Use `--host-activity "..."` to record known concurrent builds/tests or other activity;
the default explicitly says that host activity was not established. A completed
run on a busy host remains correctness evidence, not a clean-host benchmark.

Fault probes kill the sender replica's sole API PID1 with SIGKILL immediately after
its persisted echo, verify peer delivery and replay from the surviving replica,
retry the same client ID without minting another row, replay exactly two messages
missed by a disconnected peer, stop Valkey and verify a durable write through
independent PostgreSQL-backed history/replay, then restore Valkey and confirm live
cross-replica delivery resumes. No duplicate frames may appear during the bounded
300 ms post-replay observation. This does not test a multi-worker supervisor or
promise cross-replica live delivery while cache pub/sub is unavailable: that case
requires PostgreSQL replay. Production proxy/TLS, mobile-device, load, privacy and
operational acceptance remain separate gates. Nonzero exit or incomplete cleanup
means failure; inspect exact run-labelled resources following the companion guide.

Fast tests without Docker:

```powershell
python -m unittest discover -s scripts/ci -p test_own_chat_rehearsal.py
```
