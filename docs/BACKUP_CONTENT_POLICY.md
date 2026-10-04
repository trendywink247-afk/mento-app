# Backup content and recovery policy — preparation

Reviewed against source on 3 October 2026. This is an activation contract, not a deployed guarantee. The architecture book requires encrypted off-site backups every six hours with message bodies excluded. Current live backups remain daily SQL copies; encryption utilities and synthetic full-schema recovery tests have passed, but are not installed in the live backup path.

## Content inventory

Founder decision, 4 October 2026: retain user-saved journal notes and moderation
report narratives in encrypted recovery archives; exclude chat history itself.
Consequently these archives can contain user-saved quotations of chat messages:
do not describe them as containing no message-derived content. Recovery identity
custody uses Bitwarden outside both VPSes. On 5 October 2026 the founder saved
the identity in a free Secure Note, retrieved it into a separate local file,
and the operator verified both its public recipient and exact canary decryption.
The same retrieved key also passed a synthetic local PostgreSQL archive restore,
including row preservation and foreign-key enforcement, with no serving database
or production data involved. The isolated container and volume were removed.
Private key contents were not displayed or committed. The separate encrypted
offline copy remains unconfirmed. This establishes key retrieval, not database
restoration, independent deletion coverage or backup activation readiness.

| Source | What the source establishes | Recovery boundary |
|---|---|---|
| `app/models/chat_message.py` | `chat_messages.body` is encrypted message content; range partitions use `chat_messages_p*`, including a default partition. | Encryption does not satisfy exclusion. Exclude message row data from the parent and every descendant while retaining schema. Validate the partition catalogue, not only today's names. |
| `app/routers/journals.py`, `app/schemas/journals.py` | Mentor-note saves copy client-supplied message text into `journal_entries.body`, with `source=chat` and conversation/message identifiers in `meta`. Manual entries also accept free text and client-shaped metadata. | Excluding chat tables alone leaves explicit chat copies. Row-level treatment of saved notes needs a stated recovery promise. `source=manual` is not proof that text contains no quotation. |
| `app/models/moderation.py` | `moderation_events.reason` is free text. | Reports may quote messages. Preserve moderation enforcement and audit integrity; do not remove the entire table to satisfy a content claim. Define treatment of narrative separately from enforcement metadata. |
| `app/models/feedback.py`, `app/models/listener_application.py` | Feedback and application narratives are separate free-text inputs. | Classify as sensitive data; they cannot be certified free of copied message text from schema alone. Do not silently discard user/application records. |
| `app/services/safety.py` | The safety write stores `result.signal.value` in `matched_terms`, with category/source/risk metadata; it deliberately does not persist the message body. | Preserve safety signals. The column name alone is not evidence of stored raw matched phrases. |
| `app/services/push.py`, `app/jobs/tasks.py` | Current notification callers construct closed templates with persona values. Transport retries persist rendered `body` and routing `data` through `push_deliver`. | This is notification text, not observed raw chat text. The generic queue API is not a content validator. Restore with outbound delivery disabled and review pending jobs before worker activation to prevent replay. |
| Stream and other external systems | A PostgreSQL dump does not capture or erase provider-held content. | Database recovery does not prove provider deletion, retention compliance or full chat recovery. Keep the existing provider until its replacement is accepted. |

Paths above are relative to `services/api`. This is a focused inventory of known content paths, not a complete data-protection audit.

## Required implementation and acceptance

1. Define the supported recovery dataset explicitly: message history intentionally absent, treatment of saved mentor notes and report narratives explicit, safety/enforcement metadata recoverable. Until that decision is implemented and tested, do not advertise backups as free of message content.
2. Test exclusions on a disposable database using synthetic sentinel text in parent/default/current/future partitions and saved notes. Assert excluded values and rows are absent after restore, schema survives, foreign keys hold, and permitted safety/account state survives. Test catalogue discovery so a renamed or newly attached partition cannot silently escape the policy.
3. Do not edit SQL dumps with text substitution or mutate production rows to prepare a backup. A row-selective export must preserve a consistent snapshot and have an explicit restore format; ordinary table-data exclusion cannot select only `source=chat` rows.
4. Use the existing authenticated encryption/decryption utilities only after recoverable private-key custody outside both VPSes is established. Put public recipients on the source host; the backup host must not receive the decrypting identity. Rehearse recovery with the retained identity before scheduling activation.
5. Restore into an isolated destination with outbound integrations disabled. Reconcile deletion requests made after the snapshot before serving traffic. Define how the deletion ledger itself survives loss of the primary; a ledger present only in the same old snapshot cannot cover later deletions. Review queued jobs before worker startup.
6. Activate the six-hour schedule only after testing overlap prevention, resource limits on both hosts, failure notification, archive freshness and off-host copy verification. Retention expiry must be separately reviewed and tested; preserve existing archives during preparation.

## Evidence and remaining decisions

PR #35 and Test CI run `37122366037` proved encrypted recovery of the migrated application schema with synthetic relational fixtures, revision equality, foreign-key enforcement and `alembic check`. They did **not** prove exclusions, real production data recovery, key custody, deletion reconciliation or six-hour operations.

Saved notes and report narratives are retained by the founder decision above.
Implementation must now prove chat-history exclusion alongside recovery of these
retained records and safety enforcement. Bitwarden key retrieval is verified;
the encrypted offline copy, full database recovery and deletion reconciliation
remain acceptance gates. Production promotion remains disabled.

## Prepared operator sequence (not activated)

The repository now separates snapshot creation from transport verification:

1. `deploy/create-encrypted-recovery.sh CONTAINER DB_USER DB_NAME PUBLIC_RECIPIENTS NEW_ARCHIVE.age` locks the output directory, exports a consistent snapshot excluding chat table data and descendants, encrypts it, and cleans its newly created temporary plaintext. It does not remove existing backups. Supply an existing private output directory and a new output name. Only a public recipient file belongs on the source VPS.
2. `deploy/copy-encrypted-recovery.sh NEW_ARCHIVE.age RCLONE_REMOTE_DIRECTORY` uploads under its SHA-256 filename, skips existing targets, reads back bytes and compares both the remote and current local digest. A mismatch fails and preserves the local archive. A matching age header is only a format check; it does not authenticate a file or prove that the recovery identity works.
3. On an isolated recovery machine, authenticate/decrypt using the separately held identity and run the documented database recovery drill. Keep external integrations and workers disabled until deletion reconciliation and queued-job review pass.

An orchestrator must serialize the complete creation/copy operation. The creation lock ends before copying. Configure one writer per remote prefix; these utilities do not implement server-enforced object locks or protection against a concurrent privileged writer. Do not interpret rclone flags as immutable storage. No retention deletion or scheduler is added by these commands.

Linux Test CI `37198829141` verified the integrated snapshot/encryption utility on both current and production-baseline schemas. Test CI `37198830809` verified actual rclone local-backend round trips, idempotent retry, plaintext rejection and detection of corrupted ciphertext even when size and modification time match. Earlier `--immutable`-only handling failed the corrupt-target regression; the corrected implementation skips existing objects and verifies their bytes. These tests do not establish live SFTP acceptance, off-device identity custody or operational six-hour backups.

Account erasure currently deliberately records counts without a member identifier (`services/erasure.py`). Those audit rows cannot be used to reconstruct a post-snapshot deletion list. Recovery must remain closed to traffic until a separate durable deletion-reconciliation mechanism is implemented and tested, including loss of the primary after erasure. Do not claim replay coverage from the existing audit log.
### Deletion receipt preparation

The candidate schema adds `erasure_receipts`: a domain-separated SHA-256 digest
of the random member UUID and a timestamp, without a foreign key or raw identity.
The same transaction writes it and removes the account; rollback removes both
changes. These are pseudonymous, linkable-to-a-backup records, not anonymous data.
They contain no chat, journal, report narrative, email or persona.

This is the first part of deletion reconciliation, not completed disaster recovery.
Receipts must be replicated durably outside the primary before recovery can rely
on them; receipt export, independent durability, complete-coverage checks and
isolated replay still require implementation and acceptance. Do not acknowledge
that an old snapshot is safe to serve merely because it contains this table.
Do not automatically prune receipts until every backup that could resurrect the
associated account has expired and expiry is verified. A downgrade refuses to
drop a nonempty receipt table. No live migration or new backup schedule is enabled
by this change. The public erasure policy needs reconciliation before activation.
`services/recovery_reconciliation.py` supplies database-only replay for an
isolated restored database. It validates digest syntax before changing rows,
refuses live mentor identities for separate review, adjusts active seats, and
uses the existing deletion/detachment inventory. The caller owns the transaction.
It neither contacts Stream nor publishes chat events. There is deliberately no
public endpoint or automatic production invocation. A supplied set of digests is
not evidence that all deletions were captured: durable replication and coverage
verification remain required. Keep all restored jobs and serving processes off.
### Off-primary acknowledgement gate (preparation)

`RECOVERY_RECEIPT_REQUIRED` defaults to false until a dedicated receiver is deployed
and accepted. When enabled, erasure sends only a version and member digest to
`RECOVERY_RECEIPT_URL` over HTTPS with a separate `RECOVERY_RECEIPT_TOKEN`. It refuses
redirects, environment proxies, missing credentials and nonmatching acknowledgements.
The receiver must return HTTP 200 with the same digest, version 1 and `durable: true`
only after its durable commit. The local account deletion then proceeds. A failed
acknowledgement returns the existing retryable erasure error and retains the account.

A remotely recorded deletion intent can survive a later local transaction rollback;
that intent still represents the member's deletion request and must be included in
recovery reconciliation. Retries must be idempotent by digest. Never use a staging
application database as the production receiver. Receiver provisioning, durable
storage/fsync acceptance, isolation, secret rotation, recovery export and complete
coverage across the transition remain mandatory before enabling this flag. No
receiver or replication is deployed by this client implementation.
