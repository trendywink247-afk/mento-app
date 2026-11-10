# Own-chat spike — can Mento carry its own chat instead of Stream?

Branch `spike/own-chat` (worktree `.claude/worktrees/own-chat-spike`), 2026-09-20. **Not merged, not deployed, prod untouched.** Runs on its own database (`mento_spike`) and port (8090).

## Why

Stream's free tier caps monthly active users at 1,000, and the dev app is at 958. The cause is test users nobody deletes, but the founder's call is not to build further on Stream. The constraints from `chat-stack-evaluation-2026-09-20` stand: the crisis scan must sit on the message path, personas must stay anonymous, Clean Wipe must really delete, and safety staff must be able to read a flagged conversation. Ruled out: end-to-end encrypted stacks (the server can't scan), phone-OTP auth, per-user-priced vendors.

## Design in one paragraph

The API owns the message path. A WebSocket per participant per conversation; every `send` goes through one function (`services/chat.py::send`) that runs, in the same order as the old Stream hook: **crisis scan → allowance (only for unflagged messages) → PII redaction → persist**. There is no other way to write a message, so there is nothing to bypass and no "fail-open webhook". Messages get a per-conversation `seq` and a client-supplied `client_id`, which makes sends exactly-once and reconnects lossless ("give me everything after seq N"). Fan-out across workers is Redis pub/sub, and it may be lossy because Postgres is the source of truth. Presence is a Redis hash with a TTL.

## What exists on this branch

| File | Role |
|---|---|
| `app/models/chat_message.py` + migration `c0chat0spike1` | `chat_messages` (seq, client_id, body, crisis signal), `chat_read_markers` |
| `app/services/chat.py` | the send pipeline, history, read markers, Clean Wipe. Reuses `safety`, `allowance`, `moderation`, `snooze` **unchanged** |
| `app/chat_hub.py` | local sockets, Redis pub/sub fan-out, Redis presence, degrades to local-only without Redis |
| `app/routers/chat.py` | `WS /chat/ws/{id}`, `GET /chat/{id}/messages`, `POST /chat/{id}/wipe`, dev-only session seeder + demo page |
| `tests/test_own_chat.py` | 10 tests against Postgres |
| `spike/chat_demo.html`, `spike/bench_chat.py` | two-pane demo and latency bench |

The wire shape for a crisis message is the object the Stream hook produced, so the existing `CrisisCard` renders it unchanged.

## Evidence

- **10/10 own-chat tests**: two-party ordering, typing and read state, exactly-once retry, crisis flag + helpline card (signal only, never the body), allowance holds the 4th message but never a crisis one, PII redaction, reconnect replay of exactly the missed messages, only the two participants can join (stranger, admin token and garbage all refused), history + Clean Wipe delete, ended conversation refuses messages.
- **Browser proof (real Chromium, 10 checks, 0 console errors)**: exchange, read receipt, crisis card on both sides, presence, drop and reconnect with catch-up and no duplicates, typing clears, Clean Wipe empties both panes. Screenshot: `docs/superpowers/spike-artifacts/own-chat-demo.png`.
- **Two uvicorn workers**: both held a Redis subscription, so cross-worker delivery was exercised.
- **Latency (send → other side receives, full pipeline including DB commits):**

| Load | delivered | p50 | p95 | p99 |
|---|---|---|---|---|
| 10 chats, 200 msgs | 200, 0 errors | 98 ms | **146 ms** | 264 ms |
| 30 chats, 600 msgs (saturated) | 600, 0 errors | 360 ms | 545 ms | 629 ms |

  The target in `CLAUDE.md` is p95 < 500 ms. The second row is a firehose (every chat replies the instant it hears, ~100× a human rate) on a laptop also running two other lanes' jest, tsc and Expo, and throughput plateaued near 25 msg/s. Thirty real chats are roughly 3 msg/s. The obvious cost is ~10 queries and 3 commits per message (mostly `allowance.register`); merging those is the first optimisation.

## What replaces each Stream touchpoint

| Stream use today | Own-chat |
|---|---|
| before-send + `message.new` webhooks | `chat.send` (inline, the only write path) |
| `upsert_user` / `ensure_user` / `user_token` / `rename_user` | nothing: personas already live in our DB; the token is our JWT |
| `create_dm_channel` (matching) | nothing: the conversation row is the channel (`stream_channel_id = id`; rename the column later) |
| `freeze_channel` (safety end) | conversation status → `ended`: join and send are refused. **TODO:** push an `ended` event and close live sockets |
| `wipe_channel` / `erase_channel` / `delete_user` | `chat.wipe`; messages also `ON DELETE CASCADE` with the conversation |
| admin safety view `fetch_channel_messages` | `chat.history` |
| listener console `channel_last_message_at` | `MAX(created_at)` query |
| push `_is_watching` | `hub.is_connected` (now Redis-backed, so cross-worker) |
| health `stream_configured`, boot invariant on Stream creds | delete: the scan cannot be misconfigured off |

## The real work that is NOT done

1. **Clients.** Web threads (`ChatScreen.web`, `MentorChatScreen.web`) are already hand-rolled, so that is a protocol swap. Native uses the stream-chat-expo kit with our Composer override, so it needs its own message list (inverted `FlatList`, the existing `MessageText`/`Composer`/`CrisisCard`), reconnect with `after=seq`, an outbox for sends made offline, and typing/read wiring. This is the biggest piece.
2. **Backups.** Message bodies now live in our Postgres, so `deploy/backup-postgres.sh` snapshots would keep "wiped" conversations. The wipe promise ("deleted from our servers") needs the table excluded from dumps or a short retention. Decide before any cutover.
3. **Privacy copy.** `docs/PRIVACY.md` describes Stream as the holder of message bodies; it becomes us. Retention and at-rest encryption need a decision.
4. **Hardening.** Per-socket rate limit and frame-size cap, a Postgres `statement_timeout`, ping/heartbeat cadence in the client, and a graceful `ended` push. In the browser proof, one of five runs (after the presence fix) hung on the Clean Wipe request and could not be reproduced in the following runs. Unexplained; the statement timeout is the mitigation.
5. **Push notifications** to the offline side (`push.py` swaps `_is_watching`).
6. **Migration.** Prod has ~30 open conversations. Options: a hard cutover at an app release (small numbers make this realistic), or new conversations on own-chat and old ones drained on Stream.
7. **Not verified:** iOS/Android devices, a run on the VPS, and Stream's actual paid-tier price for comparison.

## Rough size

Server pipeline: proven tonight. Rest, at focused pace: web client ~1 day, native list ~2–3 days, hardening + push + backups + admin/console swaps ~2 days, cutover ~1 day. That is about a week to a shippable swap, not tonight.

## Verdict

Practical. The part that could have killed the idea — keeping the crisis scan, allowance, redaction, exactly-once and reconnect guarantees on our own path — works and is smaller than the Stream webhook code it replaces. What remains is client work and product decisions (backups, privacy copy), not new risk.
