# Push notifications — design

**Date:** 2026-09-05 · **Status:** approved by founder in brainstorm (terminal) · **Builds on:** device registration (session 25, `routers/notifications.py`, `lib/pushNotifications.ts`), the Stream async `message.new` webhook (`routers/stream_hooks.py`), the native mentor console (DECISIONS §K.9).

## 1. Goal

A mentor learns that someone wants to talk or wrote to them while they are away from the chat; a member learns that their mentor accepted or replied. Nothing else: no re-engagement, no schedules, no badges. Pushes carry a persona name and never message text.

## 2. Founder rulings

| Question | Ruling |
|---|---|
| Audience | Mentors **and** members, this phase. |
| Member triggers | Conversation events only (accepted, reply). No check-ins, no nudges (T&S #5). |
| Content | Persona name only; never a preview, never a body. |
| Away detection | Stream channel watchers; a recipient watching the channel gets no push. |
| Architecture | Send from the existing verified Stream webhook + request endpoints via Expo's push API; FastAPI background tasks; no queue, no worker. |

## 3. Registration and audience

- `push_tokens` gains `owner_kind` (`member` \| `listener`, default `member`) and `owner_id` (String 36). Migration backfills `owner_id = user_id` for existing rows; `user_id` stays for one release and is dropped in a later cleanup (not this spec). Uniqueness stays on `expo_push_token`: one device re-registering under another owner re-points the row.
- Endpoints, one shared upsert in `services/push.py::upsert_token(db, owner_kind, owner_id, token, platform)`:
  - `POST /notifications/register-token` (member auth, unchanged path) → `owner_kind=member`.
  - `POST /listener/me/push-token` (listener auth, live vetting check) → `owner_kind=listener`. Rate limit 20/h per listener.
  - `DELETE /notifications/register-token` (member auth, body `{expo_push_token}`) → removes that row if owned by the caller; called by Start Fresh before `clearSession`.
- Client: `lib/pushNotifications.ts` becomes `registerPush(kind: 'member' | 'listener')` sharing permission + token logic; called from `(tabs)/_layout.tsx` (member, as today) and from Mentor Home's `ConsoleBody` once the listener token exists. Permission is requested on first entry to either surface, never on landing. Web and simulators are silent no-ops (unchanged).
- Send-time guard for listeners: the profile must be `vetting_status == approved`; status may be online **or** away (a mentor on a break still wants to know a request arrived). Suspended → never.

## 4. Triggers and suppression

| Event | Recipient | Body (EN, server template) | Data |
|---|---|---|---|
| Personal request created | target listener | "Someone would like to talk with you" | `{kind: "request", request_id}` |
| Request accepted (console or admin stand-in) | requester member | "%{persona} is ready to talk" | `{kind: "accepted", conversation_id, stream_channel_id}` |
| `message.new` from the member | listener | "%{persona} sent a message" | `{kind: "message", conversation_id, stream_channel_id}` |
| `message.new` from the listener | member | "%{persona} replied" | `{kind: "message", conversation_id, stream_channel_id}` |

`persona` is the **other** party's persona name. Title is always "Mento". `sound` is always `null` (no audio anywhere, T&S #11).

Suppression, evaluated in order, first match wins (log the reason as a counter, never the ids):

1. recipient has no token rows;
2. listener recipient not approved;
3. conversation not `active` (message events only);
4. sender is the recipient (self-echo);
5. recipient is a current **watcher** of the Stream channel (message events only);
6. member recipient has `is_paused` on that conversation (Panda Pause — message events only; `accepted` still sends);
7. burst window: Redis key `push:burst:{conversation_id}:{recipient_id}` with a 60 s TTL already exists (message events only) — set it when a send goes out.

Crisis-flagged messages are pushed exactly like any other message (same body template). Nothing is ever added to a push because of a crisis flag, and crisis pushes are not counted anywhere.

Delivery: one Expo push API call per recipient device (all of the recipient's tokens in one request), one retry after 1 s on a network error, then give up. Receipt handling: an immediate response error `DeviceNotRegistered` deletes that token row; other errors are counted and dropped. No quiet hours (the OS owns Do Not Disturb).

## 5. Content and privacy

- Templates are a closed dict in `services/push.py`; no free text ever enters a push.
- Payload never contains message text, member ids, listener ids beyond what `conversation_id` implies, emails, or ages.
- Analytics: no event is captured for sends or taps (`lib/analytics.ts` union unchanged).
- `docs/PRIVACY.md`: one line — pushes show the other person's persona name and never message content; they can be turned off in system settings.

## 6. App-side handling and tap routing

- New `lib/notifications.ts`:
  - `installNotificationHandler()` — `Notifications.setNotificationHandler` returning `shouldShowAlert: true, shouldPlaySound: false, shouldSetBadge: false` (foreground banners, no sound).
  - `routeForNotification(data, ctx): Href | null` — pure function. `ctx = { hasMemberSession: boolean; hasListenerToken: boolean; memberConversationIds?: Set<string> }`. Rules: `request` → `/mentor-home` if `hasListenerToken` else `null`; `accepted` → `/chat/[id]` (params `id`, `channel`) if `hasMemberSession`; `message` → if the conversation id is in `memberConversationIds` → `/chat/[id]`, else if `hasListenerToken` → `/mentor/chat/[id]` (params `id`, `channel`), else fallback: `/chats` when `hasMemberSession`, `/mentor-home` when `hasListenerToken`, else `null`.
  - `useNotificationTaps()` — hook mounted once in `app/_layout.tsx`: subscribes `addNotificationResponseReceivedListener` and reads `getLastNotificationResponseAsync` on cold start; resolves `ctx` (session token, listener token, and the member's conversation ids via `api.listConversations()` only when a `message` tap arrives), then `router.push(route)`; ignores taps while no session exists (the landing takes over).
- `registerPush(kind)` as in §3; no settings screen, no in-app inbox, no badges.
- Native only: web bundle gets a no-op module via `lib/notifications.web.ts`.

## 7. Server components

| Piece | Detail |
|---|---|
| Migration | `push_tokens.owner_kind` (enum `pushownerkind` member/listener, server_default member), `owner_id` String(36) nullable then backfilled from `user_id` and made NOT NULL; index on `(owner_kind, owner_id)`. |
| `services/push.py` | `upsert_token`, `delete_token`, `notify_request_created(db, request)`, `notify_request_accepted(db, request, convo)`, `notify_message(db, convo, sender_kind)`; internal `_send(tokens, title, body, data)` using `httpx` against `https://exp.host/--/api/v2/push/send`; `_is_watching(channel_id, user_id)` via the Stream server client's channel query with `watchers` (result cached 5 s in Redis per channel; on any Stream error assume **not** watching, i.e. send). |
| Settings | `push_enabled: bool = True` (tests set False via conftest, like rate limits); `push_burst_seconds: int = 60`. |
| Triggers | `routers/listeners.py request_listener` → `notify_request_created`; `services/matching.accept_personal_request` returns the convo so both accept endpoints call `notify_request_accepted`; `routers/stream_hooks.push_webhook` schedules `BackgroundTasks.add_task(notify_message_safe, …)` **after** `_run_scan` returns, where `notify_message_safe` wraps everything in try/except + log. The webhook's response and the scan result can never depend on push. |
| Listener endpoint | `POST /listener/me/push-token` on `routers/listener_console.py`. |
| Member delete | `DELETE /notifications/register-token`. |
| Script | `scripts/send_test_push.py` calls `services.push._send` (kept for device verification). |

Failure philosophy matches the crisis webhook: push is best-effort and never blocks or degrades a conversation; failures are logged with counts only.

## 8. Testing

**Pytest** (Expo call mocked with a recorder; Stream watcher query mocked):
- register: member and listener upserts; a token moving from member to listener re-points one row; delete removes only own rows.
- triggers: request created → exactly one send to the target listener's tokens with the request template; accepted (console path and admin path) → one send to the member; member message → listener; listener message → member; persona in the body is the other party's.
- suppression: each of the seven rules, one test each (no token; suspended listener; ended conversation; self-send; watching; paused member gets no message push but does get accepted; burst window suppresses the second message within 60 s and allows after expiry using a fake clock/TTL).
- crisis: a flagged message sends the plain template and nothing else.
- resilience: `_send` raising never changes `push_webhook`'s 200 or the scan's `SafetyFlag` row; `DeviceNotRegistered` deletes the token; network error retried once.
- migration: `alembic check` clean; backfill sets `owner_id` for a pre-existing row.

**Mobile:** `npx tsc --noEmit`; `routeForNotification` covered by a small Node test (`lib/__tests__/notifications.test.ts` run with `node --test` via `tsx` if present, otherwise a plain `.mjs` using the compiled logic — decide in the plan); web e2e unaffected (no-op module).

**Device proof** (founder + session, on the APK): one phone holding both a member session and a mentor credential; from the web: send a Personal request → push arrives → tap → Mentor Home; accept from the phone; send a member message from the web while the mentor chat is closed → push → tap → mentor chat; send a member message from the web while the mentor chat is OPEN on the phone → **no** push (watcher suppression). Member-side pushes need a second phone holding a member session (the web member never receives pushes); if only one phone is available, verify the member path by pytest only and log it.

## 9. Out of scope

Quiet hours, per-user push preferences, localized push text, badges, an in-app notification inbox, web console pushes, member re-engagement of any kind, dropping `push_tokens.user_id`.

## 10. Docs when shipped

CLAUDE.md Stack table push row (device registration → "registration + sends: request/accepted/message, persona-only"), env `PUSH_ENABLED`; DECISIONS §K.10 with the five rulings; PROGRESS entry; PRIVACY line.
