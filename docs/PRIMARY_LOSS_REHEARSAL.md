# Synthetic primary-loss rehearsal

This is a repeatable local test of source-database loss, encrypted snapshot restore
and post-snapshot deletion reconciliation. It uses only newly allocated, uniquely
labeled Docker resources and synthetic accounts, credentials, keys and certificates.
It never accepts an existing database/container/volume or a real recovery identity.
No host ports, API server, job worker, VPS or external provider are involved.
Remote Docker SSH/TCP endpoints and Python assertion-disabled mode are refused.

The rehearsal:

1. Pins already available app/receiver/PostgreSQL images by immutable image ID and
   creates an internal-only network, source PostgreSQL volume and independent receiver
   volume. Every cleanup requires the run label, per-resource nonce and original
   container/network ID or volume creation identity.
2. Applies the actual schema migrations and seeds two accounts with usable refresh
   and recovery credentials, saved mentor notes, own-chat rooms and encrypted chat rows.
3. Runs `export-recovery-snapshot.sh` against real PostgreSQL, excluding chat-table
   data and all discovered partitions. It encrypts that snapshot with installed `age`
   and a newly generated synthetic identity, publishes without overwrite and removes
   the plaintext dump. The age identity/archive stay outside all container mounts.
4. Erases one account **after** the snapshot through the real erasure service. Its
   real HTTPS acknowledgement contract posts to the independent receiver using only
   a throwaway CA; receiver storage commits the receipt. The controlled local Docker
   administrator exports it, creates a full checkpoint and retains its hash **before**
   destroying the source. Export retrieval is not a public receiver HTTP endpoint.
5. Removes the source PostgreSQL container **and its data volume**, verifies both
   are absent, and restarts the independent receiver to verify the receipt survived.
6. Verifies the previously pinned ciphertext hash, genuinely decrypts the age archive,
   and restores SQL into a different, newly created PostgreSQL container and volume.
7. Verifies the full receipt export against the previously pinned checkpoint hash,
   then replays database-only deletion. The restored stale account, saved note,
   room and refresh/recovery credentials must disappear. The other account's notes,
   room and both credential mechanisms must remain usable. Chat rows must be absent
   and a second replay must change zero accounts. Serving integrations are forbidden.
8. Removes every owned runtime resource and private fixture/key file. Only count,
   phase, image/resource-ID and hash evidence remains under `.local/primary-loss`.

An age archive or hash alone does **not** authenticate its origin. The trust boundary
here is the controlled local Docker administrator and a witness/hash retained before
loss, separately from the source database. Do not create a new checkpoint from a
suspect recovered export: full pinned witness coverage is required for replay.

## Run locally

Use the existing local images. The app image supplies dependencies; the worktree's
app and migration source is mounted read-only. No image is pulled or promoted. Tracked app/migration source must be clean; evidence
records the worktree revision/dirty status and fixture, orchestrator and exporter
hashes. The image is a dependency carrier, not a claim about the mounted app revision.
The source fingerprint must remain unchanged through the run. PostgreSQL readiness
requires TCP plus a successful query, avoiding its temporary initialization server.

```powershell
Set-Location 'H:\Mento gpt\Mento\.local\worktrees\primary-loss-rehearsal'
$drillAge = (Get-Command age.exe).Source
$drillKeygen = (Get-Command age-keygen.exe).Source
& 'H:/Mento gpt/Mento/services/api/.venv/Scripts/python.exe' deploy/rehearse-primary-loss.py `
  --app-image mento-same-db-rehearsal:ee09c82 `
  --receiver-image mento-recovery-receiver:local-20261005 `
  --bash 'C:/Program Files/Git/bin/bash.exe' --age $drillAge --age-keygen $drillKeygen
& 'H:/Mento gpt/Mento/services/api/.venv/Scripts/python.exe' -m unittest scripts/test_primary_loss_rehearsal.py -q
```

Linux can supply installed Bash/age/age-keygen paths instead. The evidence artifact
marks failures and cleanup outcome; stdout never prints keys or synthetic credentials.
A daemon outage, changed resource identity or failed volume deletion fails acceptance.
Cleanup never deletes by a generated name alone or removes unowned resources.

## Limits of this evidence

This proves only synthetic local coverage for the one post-snapshot deletion. The
receiver and archive still exist on the same local machine: it does not prove an
independent physical failure domain, historical receipt completeness, off-host
retrieval, real key custody, production schema/data recovery or serving permission.
No backup schedule, six-hour operation, alert delivery or production activation follows.
The Windows orchestration composes the real exporter with real age; it does **not**
exercise the production Linux backup-cycle/flock wrapper. That wrapper's separate
Linux tests remain separate evidence. Operational acceptance still requires the
actual independent receiver, complete durable deletion coverage, authentic off-host
artifacts/checkpoints, recovery-key retrieval and a reviewed isolated restore.
