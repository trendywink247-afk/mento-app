# Live events: the server pushes, nobody polls

One WebSocket per foreground app. The server pushes small events that carry **ids only**; the app refetches just the item named. When the app goes to the background it closes the socket and FCM push takes over. Server: `app/routers/events.py`, `app/events_hub.py`, `app/live_events.py`. Tests: `tests/test_live_events.py`.

## Contract

`GET /api/v1/events` (WebSocket). Additive: older builds keep polling and keep working.

| Step | Frame |
|---|---|
| Client, within 5 s | `{"t":"auth","token":"<bearer>","role":"member"\|"listener"}`. The token is checked exactly like the REST bearer for that role (signature, expiry, standing) and never goes in the URL |
| Server | `{"t":"hello"}` |
| Client, any time | `{"t":"bye"}`. Anything else is ignored |

Close codes: `4401` bad, missing or late auth, or the token expired; `4403` standing lost (suspended, banned, mentor revoked); `4409` replaced (max 3 sockets per identity, the oldest goes); `1009` frame over 1 KB; `1013` too slow to read; `4429` reconnecting too fast (30 per 5 min per identity).

Keepalive is the WebSocket protocol ping (uvicorn `--ws-ping-interval 25 --ws-ping-timeout 20`): a few bytes, no app frames, no app code.

### Events

| Event | To | When |
|---|---|---|
| `{"t":"request.new","id"}` | Mentors whose inbox now holds it | A member asks a mentor, or broadcasts |
| `{"t":"request.gone","id"}` | Mentors whose inbox held it, plus the mentor who acted | Taken, accepted, declined, passed (that mentor only), withdrawn, expired |
| `{"t":"request.changed","id","status"}` | The asking member | Matched, declined, expired |
| `{"t":"conversation.changed","id"}` | Member and/or mentor of that chat | Opened, ended, a message sent (both), read (the reader), snoozed or woken (mentor), exam suggestion (both), the mentor went online/away (members of their active chats) |
| `{"t":"review.decided"}` | The applicant (member) or the mentor whose document it was | Application approved/declined; verification document decided |

Own-chat socket (`/chat/ws/{id}`), additive frames: `{"t":"state","exam_redirect":bool,"status":"active"\|"ended"}` when the mentor suggests an exam mentor or the chat ends (sent before `ended`), and `pong` now carries `last_seq` so the client fetches history only when it missed something. Older clients ignore unknown frames and fields (`lib/ownChatClient.ts`).

## How the right people, and only they, hear it

- **Requests.** `services/request_visibility.inbox_clause` is the WHERE clause of `GET /listener/me/requests`; `recipient_ids` asks the same clause the other way round. One rule, tested to agree (`test_recipients_are_exactly_the_mentors_whose_inbox_lists_it`). For a broadcast that is taken, recipients are resolved before the target is set, while those inboxes still match. Chosen over a server-side filter per socket: one query per event instead of one per connected mentor.
- **Everything else** goes to the ids on the row (requester, target, conversation's member and mentor).
- Events carry ids only: no text, names or anything personal. An unrelated member or mentor never receives another's ids (tested with a probe per socket).

## Delivery

- `live_events.emit(db, ...)` queues on the session; published only when the root transaction commits, dropped on rollback. `live_events.publish(...)` is for code whose commit already happened. Neither can fail a request.
- One Valkey channel, `mento:ev:bus`, payload `{"m":[member ids],"l":[listener ids],"ev":{...}}`. Each process holds one subscription and routes in memory to its own sockets. Valkey down: in-process fan-out; apps catch up on their next refetch (on focus or reconnect).
- Jobs (no event loop) publish straight to Valkey.

## Presence (no behaviour change)

While a mentor has an events socket open, the server itself touches `last_seen_at`: on connect, then every 5 minutes in one batched `UPDATE` per process. The existing stale-presence sweep reads the same column, so "online" means what it did when the console sent `POST /listener/me/heartbeat` every 5 minutes. That endpoint stays for older builds.

## Cost and scaling

- Per process: one Valkey subscription, one sweeper task (60 s tick; one DB round every 5 min for standing + presence of all its sockets). Per socket: one small queue (32 events) and one writer task; no per-socket timers or DB reads.
- Valkey clients: commands have 2 s timeouts, keepalive and a 30 s health check; the subscriber has no read timeout (it blocks until a message), so an idle subscription never turns into a reconnect loop. The rate-limit client is a bounded pool (30).
- A slow socket is dropped (1013), never allowed to stall anyone else.
- Load test: `scripts/load/events_ws.js` (k6), local or throwaway stacks only.

## Not covered

- A member's erasure expires their pending requests in bulk without `request.gone` (deletion path left untouched); a mentor sees it gone on their next refetch.
- Stream-backed (legacy) chats: messages arrive through Stream's own client, so no `conversation.changed` per message for them.
