# Operational monitoring acceptance

`external-monitor.sh` and its two classifiers are installed together. Preserve the
existing private notification topic and state directory when upgrading. Probe-only
mode (`MONITOR_CHECK_ONLY=1`) never sends alerts or writes notification state.
HTTP/safety status checks alone do not establish worker, backup or host acceptance.

An optional `MONITOR_OPERATIONAL_PROBE` names a trusted executable wrapper. It must
emit only the JSON from `operational-monitor-probe.py`, and return nonzero if remote
execution fails. The monitor invokes it directly, without shell evaluation, with
a 20-second bound. A wrapper can use pinned, batch-mode SSH to execute the installed
read-only probe on the monitored host; no broad deploy credentials belong in it.
Without the wrapper, probe-only output explicitly says operational probes are skipped.
Do not interpret that result as complete operational acceptance.

On the monitored Linux host, the collector reads `/proc/meminfo`, load and disk
availability and invokes `queue_health` inside `MONITOR_WORKER_CONTAINER` (default
`mento-worker-prod`). Set this explicitly for staging or a changed topology. The
collector checks the worker command and emits counts/booleans only, never job
arguments, task names, private settings or error details. Its read-only queue
queries do not enqueue a job or prove job execution. Heartbeat evidence is for the
current single-worker topology; per-worker identities are required for replicas.

Set `MONITOR_BACKUP_MARKER` to a producer-owned, atomically replaced JSON marker:

```json
{"version":1,"completed_at":1791158400,"archive_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
```

The backup producer writes the actual UTC Unix completion time and actual encrypted
archive SHA-256 only after encryption verification and verified independent copy
succeed. Do not touch the marker on failed export, failed remote copy or failed
verification. The timestamp is a freshness signal, not a restore/custody/deletion
coverage guarantee; changing file mtime cannot establish backup success.

Also configure `MONITOR_BACKUP_RESULT` for immediate failure detection. The producer
atomically records the last cycle outcome with the strict schema
`{"version":1,"status":"success","attempted_at":1791158400}` (or `"failed"`).
Record failure without replacing the last successful archive marker. A failed,
missing, malformed, future or stale configured result fails backup monitoring even
while the preceding successful archive is fresh. Without this optional result path,
failures are detected only when the successful archive exceeds the freshness limit.

Default failure thresholds are available memory below 128 MiB, disk below 1024 MiB,
one-minute load above 2 per CPU, due-job age above 300 seconds, any failed job in
24 hours, and backup completion older than 8 hours (six-hour cadence plus two-hour
slack). Configuration names: `MONITOR_MIN_MEMORY_MIB`, `MONITOR_MIN_DISK_MIB`,
`MONITOR_MAX_LOAD_PER_CPU`, `MONITOR_MAX_BACKLOG_SECONDS`, `MONITOR_MAX_FAILED_JOBS`,
`MONITOR_MAX_BACKUP_AGE_SECONDS`. Thresholds must be finite and nonnegative. Evidence
older than 120 seconds, future timestamps, malformed JSON and missing fields fail
closed. These initial thresholds require workload calibration, not capacity claims.

Before live activation: configure restricted SSH access and the actual worker;
install the scripts/classifiers; wire the verified backup producer marker; run
probe-only checks; deliberately induce synthetic failure/recovery and verify the
operator receives both alerts. Repeat from A for B with host-appropriate checks.
An independent dead-man service and responsible recipient remain prerequisites;
these scripts alone cannot detect both hosts failing simultaneously. No delivered
alert acceptance follows from simulated curl tests.
