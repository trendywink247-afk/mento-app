# Performance, Valkey and database review

Reviewed 2026-11-11 by reading the code and compose files. Nothing was measured on a live host, and no load was generated. Items marked **Proposal** need the owner or root to act.

## 1. Valkey (Redis)

What uses it: rate limits (`ratelimit.py`), WebSocket fan-out and presence (`chat_hub.py`), a 30 s mentor-brief cache (`services/stream.py`), the age-gate cooldown (`routers/onboarding.py`), and the webhook-liveness stamp (`routers/stream_hooks.py`).

### Config by environment

| Stack | File | Before | Now |
|---|---|---|---|
| Local and the Balanced base | `deploy/compose.base.yml` | no `maxmemory`, no policy, default snapshotting | `--save "" --appendonly no --maxmemory 128mb --maxmemory-policy volatile-lru` |
| Balanced prod | `deploy/compose.prod.yml` | same flags, no container limit | same flags, plus `mem_limit: 192m` |
| QA (staging) | `deploy/staging/compose.yml` | 48 MB, `volatile-lru`, no persistence, `mem_limit 80m` | unchanged (already correct) |
| Legacy prod | `deploy/docker-compose.prod.yml` | Redis 7 with `appendonly yes` | marked SUPERSEDED in its header; still drilled by `deploy/test-deploy.sh`, so not deleted |

`deploy/test-parity.sh` ignores `command` and `mem_limit`, so the base change does not affect the parity check.

### Every key has a TTL

| Key | Written by | TTL | Evictable under `volatile-lru` |
|---|---|---|---|
| `rl:<name>:<id>` | `ratelimit.allow` | `EXPIRE ... NX` in the same pipeline as `INCR` | yes |
| age-gate counters and install key | `routers/onboarding.py` | `AGE_COOLDOWN_SECONDS` | yes |
| `mento:chatp:<conversation>` (presence hash) | `chat_hub` | 150 s, refreshed by each socket ping | yes |
| `brief:lma:<channel>` | `services/stream.py` | 30 s (5 s for the error sentinel) | yes |
| `mento:last_webhook_at` | `routers/stream_hooks.py` | **none** | no (one tiny key, harmless) |
| `mento:chat:<conversation>` | pub/sub channel | not a key | n/a |

Only `mento:last_webhook_at` has no TTL. It is a single small key, so it cannot fill memory, but it means "everything is evictable" is not literally true. Giving it a long `ex=` would need a code change on the crisis-health path, so it was left alone.

### Connections and failure behaviour

| Item | State | Note |
|---|---|---|
| Rate-limit client | one cached client per process, 0.5 s connect and read timeout | a slow Valkey costs at most 0.5 s per limited request, then it fails open |
| Pool size | redis-py default (unbounded) | **Proposal:** `max_connections` of 50 on the cached client; hitting it raises a RedisError, which already fails open or closed as designed |
| Chat hub async client | `from_url` with no timeouts | **Proposal:** add `socket_timeout` and `health_check_interval=30`; a half-open TCP connection currently stalls the pub/sub listener until the OS notices |
| Fail-open | the general limiter allows the request and logs a warning | PIN guard, mentor-code exchange, `me.py` and the age gate use `fail_closed=True` (503) |
| Health | `/health/ready` reports `redis` but never fails on it | an outage is visible only in that field and in logs; **Proposal:** alert on it in the external monitor |

### GlitchTip shares the cache

`deploy/compose.prod.yml` points GlitchTip at `redis://valkey:6379/1`, the same instance. Its queue keys have no TTL, so `volatile-lru` can never evict them. Once the 128 MB fills with them, Valkey refuses writes for everyone, including the rate limiter. **Proposal:** give GlitchTip its own small Valkey service (`valkey-ops`, 64 MB, `noeviction`) or drop GlitchTip in favour of hosted Sentry. GlitchTip was not touched; the owner has not decided.

## 2. Database

### Pool sizing

| Setting | Code default | Prod (`compose.prod.yml`) |
|---|---|---|
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | 10 / 10 | 5 / 0 |
| API processes | | 2 workers per colour, 2 colours during a swap = 4 |
| Worker process | | 1 |
| Application slots | | 5 x 5 = 25 |
| Postgres `max_connections` | | 50 |

25 of 50 leaves room for the queue connector, migrations and operators; `scripts/ci/effective_database_budget.py` enforces the budget in CI. Statement timeout is 5 s and `pool_timeout` is 5 s, so a stuck query fails fast. The code defaults (10 + 10 per process) would exceed 50 if used with four processes, so never run prod without the compose overrides.

### Indexes

Existing coverage is good: composites on conversations (`user_id, created_at`; `listener_id, status`), chat messages (`conversation_id, seq`), journals (`user_id, created_at`), mentor links, push tokens, and the request inbox `(target_listener_id, status)`.

| Hot path | Finding | Action |
|---|---|---|
| Mentor request inbox poll (`/me/requests`, every 30 s per online mentor): pending rows ordered by `created_at, id` with a broadcast branch | only a single-column `status` index and the target index; the broadcast branch has no ordered index | **Added** migration `ek01requestinboxindex01`: partial index `ix_conversation_requests_pending_order (created_at, id) WHERE status = 'pending'`, built concurrently, additive |
| `chat_messages` | table is partitioned monthly by the retention job, so `CREATE INDEX CONCURRENTLY` is not available on the parent | no change; the `(conversation_id, seq)` index already serves history and the DISTINCT ON preview query |
| `listener_applications` EXISTS inside the inbox filter | indexed on `user_id` only; table is small | watch via `pg_stat_statements`, no index yet |
| `moderation_events` block check | `(reporter_id, blocked)` exists | fine |

### Queries

| Pattern | Where | Verdict |
|---|---|---|
| N+1 | none found; related rows are loaded with one `IN (...)` query per list (listeners, links, latest conversation) | fine |
| Unbounded list | `admin_console.admin_listeners` returns every mentor; `list_admins` returns every admin; `listener_console.dev_roster` (dev only) | acceptable at launch size; **Proposal:** page `admin_listeners` before the roster passes a few hundred |
| Bounded lists | conversations (limit 200), requests (cursor), flags/applications/contributions/audit (limit 200) | fine |
| `_own_previews` | `DISTINCT ON (conversation_id)` over up to 200 chats, decrypting each last message | one query, index-backed; decryption cost grows with page size, fine at 100 |
| Mentor listing sort | `CASE` expressions over `EXISTS` subqueries per row | correct and paged by cursor; will be the first slow query as the roster grows, so watch it in `pg_stat_statements` |

### Observability (not applied)

`deploy/postgres-observability.proposal.conf` lists `pg_stat_statements` and slow-query logging (`log_min_duration_statement = 250`, lock waits, temp files, and no bound parameters in the log). It is a proposal for root: it needs one Postgres restart and changes no live host from this branch.

## 3. Load test

`scripts/load/chat_and_ratelimit.js` (k6) has three scenarios:

| Scenario | What it does | Pass condition |
|---|---|---|
| `ratelimit` | 20 requests per second at `/auth/refresh` with an invalid token | only 401 then 429, never 5xx |
| `health` | 50 requests per second at `/health` | p95 under 500 ms |
| `chat` | 20 sockets on one conversation, one message every 3 s | WebSocket upgrade p95 under 1 s; `held` and `error` frames are counted, not failed |

Run it only against a local stack or QA, with the owner's go, never production:

```bash
k6 run -e BASE_URL=http://127.0.0.1:8000 -e SCENARIO=ratelimit scripts/load/chat_and_ratelimit.js
TOKEN=... CONVO=... k6 run -e BASE_URL=... -e TOKEN=$TOKEN -e CONVO=$CONVO -e SCENARIO=chat scripts/load/chat_and_ratelimit.js
```

Take the token from your shell or `.secrets/`, never from a file in the repo. Two things to watch while it runs: the allowance (`ALLOWANCE_IN_A_ROW`) will hold most messages from one sender, and the per-user limit of 40 frames per 10 s applies. The script was written but not run in this review (k6 is not installed here).

## 4. Not done

- No load numbers: no host was exercised, so there is no measured concurrent-chat capacity.
- Valkey code hardening (pool cap, hub timeouts) is proposed, not changed.
- Deploy drills (`deploy/test-parity.sh`, `test-deploy.sh`) were not run: Docker is not usable in this environment.
