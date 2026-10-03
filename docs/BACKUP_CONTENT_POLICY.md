# Backup content and recovery policy — preparation

Reviewed against source on 3 October 2026. This is an activation contract, not a deployed guarantee. The architecture book requires encrypted off-site backups every six hours with message bodies excluded. Current live backups remain daily SQL copies; encryption utilities and synthetic full-schema recovery tests have passed, but are not installed in the live backup path.

## Content inventory

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

The remaining product boundary is whether user-saved mentor notes and narrative reports are included in encrypted recovery, redacted, or excluded with disclosed loss on restore. Engineering can build synthetic exclusion/recovery tests while that decision is outstanding; it must not erase those records or weaken Trust & Safety by inference. Production promotion remains disabled.
