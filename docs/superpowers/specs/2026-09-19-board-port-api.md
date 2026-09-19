# Board port — API wiring for the client (2026-09-19)

Server work for the final board's screens, written for whoever wires `apps/mobile`. Every
path is under `/api/v1`. Nothing here changes an existing response except additively.
Rulings: `docs/DECISIONS.md` §L (and the "pending founder veto" items under it).

**Errors.** Every refusal still answers `{"detail": "<a sentence a person can read>"}` — what
`lib/api.ts` already turns into `ApiError(status, detail)`. New refusals that the UI must
tell apart ALSO carry `"code": "<machine_code>"` beside `detail` (additive). To use it,
`request()` in `lib/api.ts` has to keep the parsed body's `code` on `ApiError`.

---

## B1 — Message allowance (DECISIONS §L.2 · boards A22, A13)

**Rule.** A member may send 3 messages in a row in one conversation before the mentor
writes, and 10 a day across all their conversations. The day is the **IST calendar day**
(00:00 Asia/Kolkata = 18:30 UTC). Mentors are never limited; any mentor message resets the
member's run in that conversation. A message the crisis scan flags is **always delivered
with its helpline card, never held, never counted** — and for 24 hours after a flag the
whole conversation is exempt.

**Rollout switch.** Counting is always on. *Holding* is on only when the API runs with
`ALLOWANCE_ENFORCED=true` (default **false**), so the server can be deployed before the app
can render the note. `enforced` in the payloads below tells the client which mode it is in.
`ALLOWANCE_ENABLED=false` switches the whole thing off. Limits: `ALLOWANCE_IN_A_ROW`,
`ALLOWANCE_PER_DAY`, `ALLOWANCE_CRISIS_EXEMPT_HOURS`.

### What the client receives when a message is held

Enforcement is in the Stream before-send hook, so the refusal arrives **through Stream, not
through our API**: `channel.sendMessage()` resolves with a message whose `type` is
`"error"`. Stream does not save it and nobody else sees it.

```jsonc
// response.message
{
  "type": "error",
  "text": "That's three in a row. Give your mentor a moment to reply.",   // EN fallback only
  "allowance": {
    "held": true,
    "reason": "in_a_row",            // or "daily"
    "in_a_row": 3, "in_a_row_limit": 3,
    "left_today": 7, "daily_limit": 10,
    "resets_at": "2026-09-19T18:30:00+00:00"
  }
}
```

Wiring notes:
- Treat **any** `type: "error"` reply on a member send as "re-read the allowance" — call
  `GET /conversations/{id}/allowance` and render A22 from that. The `allowance` custom field
  is the fast path; the endpoint is the source of truth. (Stream's documentation says a
  before-send hook may set custom fields on the message it returns; that a *rejected*
  message keeps them has not been checked against the live Stream app yet — see "Not
  verified" below. The endpoint works either way.)
- **Keep the member's draft in the composer.** The held message is gone from Stream; the
  text only exists on the device.
- Render the note as a still line (T&S #11 — no shake, no haptic, no red). Localise from
  `reason`; `text` is the English fallback an old build shows. A22's "Anything urgent is
  never held back or counted" and the helplines row are client copy.
- Both exhausted → `reason` is `"daily"` (the longer wait is the honest one to name).
- A shipped build that knows nothing about this shows Stream's own error bubble with
  `text` — readable, not pretty. That is why holding ships switched off.

### `GET /conversations/{id}/allowance` — member token

```jsonc
{
  "in_a_row": 3, "in_a_row_limit": 3,
  "sent_today": 3, "daily_limit": 10, "left_today": 7,     // "7 of 10 left today"
  "resets_at": "2026-09-19T18:30:00+00:00",                // next 00:00 IST, as UTC
  "can_send": false,
  "held_reason": "in_a_row",                               // null | "in_a_row" | "daily"
  "enforced": true
}
```
`held_reason` is what the **next** send would be held for. It is always `null` when
`enforced` is false and inside a recently crisis-flagged conversation. 404 for a
conversation that is not the caller's. Read it on chat focus, after every own send, and
when a mentor message arrives (the run resets).

### `GET /me/allowance` — member token

Same shape, for screens with no conversation yet (the first-question builder's meter).
`in_a_row` is always 0 here.

### `GET /admin/allowance?days=14` — admin token (board A13)

`days` 1–30, default 14. Oldest first, zero-filled, IST days. Each read writes an
`allowance.viewed` audit row.

```jsonc
{
  "rule": {"in_a_row": 3, "per_day": 10, "enforced": true,
           "crisis_exempt_hours": 24, "timezone": "Asia/Kolkata"},
  "days": [{
    "day": "2026-09-19",
    "messages_sent": 412,              // counted member messages
    "crisis_exempt_sends": 3,          // delivered, never counted
    "in_a_row_pauses": 21,             // times the 3-in-a-row note showed
    "members_paused_in_a_row": 14,     // how many members met it
    "daily_cap_holds": 2,              // sends held by the daily limit
    "members_reached_daily_cap": 5     // members who sent their 10th (or were held)
  }],
  "totals": { "day": "2026-09-06/2026-09-19", "...": "sums of the window" }
}
```
A13's tiles: "Member messages sent" = `messages_sent` · "Members who reached 10 for the
day" = `members_reached_daily_cap` · "Times the 3-in-a-row pause showed" =
`in_a_row_pauses` · "Crisis-exempt sends" = `crisis_exempt_sends`. Today / 7 days / 30 days
= sum the tail of `days` (`totals.members_*` add per-day member counts — the same member on
two days counts twice). No ids, names or text anywhere in the payload. "Crisis-exempt sends
link to Safety review" is a link to the existing Safety tab, not data from this endpoint.

### Not verified
- Against the live Stream app: that the rejected message reaches the sender with the
  `allowance` custom field intact, and what stream-chat-expo's `MessageList` does with it.
  Needs a tunnel + `scripts.configure_stream` (the `mento-crisis-webhook` skill) with
  `ALLOWANCE_ENFORCED=true`. Do not point the prod Stream app at a tunnel.

---

## B2 — Rotating mentor names + stay in touch (DECISIONS §L.6–7 · boards A14, A15, A06, A25, A10)

### Rotating names

- Every mentor gets a new `[Adjective] [Noun]` name once a rotation day. **The day turns at
  04:00 IST** (22:30 UTC) — not midnight, which is when people are most likely mid-chat.
  `persona_avatar` does **not** change ("same owl, new name").
- There is no scheduler: the rename happens on the first read after 04:00 of any of
  `GET /listeners`, `GET /listeners/{id}`, `GET /conversations`, `GET /conversations/{id}/mentor`,
  `POST /match`, `GET /listener/me`, `GET /in-touch`, `GET|POST /conversations/{id}/stay-in-touch`.
  The mentor's **Stream user name** is updated right after (background, retried), so the chat
  header and the bubbles agree. A mentor approved today keeps their first name until the
  next 04:00.
- Kill switch: `MENTOR_NAME_ROTATION_ENABLED=false`.

**What the member sees for a conversation** (`GET /conversations` items, additive fields
`in_touch: bool`, `first_met_as: string | null`):

| Conversation | `listener_persona_name` | `first_met_as` |
|---|---|---|
| active | the mentor's name **today** | the name when this chat began, if different |
| ended / wiped, member **in touch** with the mentor | the name **today** | the link's first-met name, if different |
| ended / wiped, **not** in touch | **the name it ended under** — frozen | the name it began under, if the chat itself crossed a 04:00; else `null` |

The frozen row is deliberate: tomorrow's name for a mentor is what the member gets by asking
to stay in touch, not for free. `GET /conversations/{id}/mentor` follows the same rule for
`persona_name` (and for `stay_in_touch.mentor_name`) and also carries `first_met_as`,
`in_touch` and `stay_in_touch` (below).
Render A06's "Your mentor · first talked as Steady Cedar" from `first_met_as` when
`in_touch` is true; for an active chat that crossed 04:00 the same field gives the header
its "first talked as" line.

`GET /listeners` items and `GET /listeners/{id}` gain `in_touch` and `first_met_as`.
**Browse order is now: in touch → (deprecated) favourites → available → rank** (A25 "In touch
first").

Mentor side: `GET /listener/me` gains `name_changes_at` (ISO UTC, the next 04:00 IST; `null`
when rotation is off) — A10's "your name changes in 9 h".

Honest limit: rotation is a *presentation* rule. `listener_id` is stable in Browse and in the
Stream channel's member list, so a modified client could follow a mentor across names. Real
unlinkability needs per-conversation Stream aliases — not built.

### Stay in touch — member (session token)

`StayInTouchOut`:
```jsonc
{
  "state": "none",                 // "none" | "asked" | "in_touch" | "not_now"
  "link_id": null,
  "can_ask": true,
  "blocked_reason": null,          // "in_touch_full" | "in_touch_waiting" | "not_now_cooldown" | "unavailable"
  "can_ask_again_at": null,        // ISO, only with not_now_cooldown
  "slots": {"limit": 2, "in_touch": 1, "waiting": 0, "free": 1},   // A14 {{ slotsText }}, A06 "In touch · 2 of 2"
  "mentor_name": "Steady Cedar",
  "first_met_as": null,            // set once asked / in touch AND the name has changed since
  "first_met_at": null,
  "names_change_at": "2026-09-19T22:30:00+00:00"
}
```

| Call | Does | Answers |
|---|---|---|
| `GET /conversations/{id}/stay-in-touch` | standing with this chat's mentor | `StayInTouchOut` (also embedded as `stay_in_touch` in `GET /conversations/{id}/mentor`) |
| `POST /conversations/{id}/stay-in-touch` | **ask** — no body, one tap, idempotent; works on an ended chat too; 10/h | `StayInTouchOut` with `state: "asked"` |
| `DELETE /conversations/{id}/stay-in-touch` | **take it back** (asked) or **end** (in touch); idempotent | `StayInTouchOut` |
| `GET /in-touch` | the In touch view | `{slots, items[], waiting[]}` |
| `DELETE /in-touch/{link_id}` | same take-back / end, keyed by link | `{"status": "taken_back" \| "ended" \| "none"}` |

Refusals of the ask are **409** `{"detail": "<calm sentence>", "code": ...}`:

| `code` | When | `detail` (EN; localise from `code`) |
|---|---|---|
| `in_touch_full` | two accepted links already | "You can stay in touch with two mentors at a time. It keeps each conversation unhurried, and it protects their time. To make room for someone new, end one of these first." (A06) |
| `in_touch_waiting` | places taken, at least one by an ask still waiting | "You have an ask still waiting for a reply, so both places are spoken for. You can take it back to make room." |
| `not_now_cooldown` | the mentor said not now < 7 days ago (+ `can_ask_again_at`) | "They said not now. You can ask again a little later." |
| `mentor_unavailable` | blocked / suspended / the member's own mentor profile | "This mentor can't be reached right now." |

404 = not the caller's conversation / link. 429 = the hourly limit. **Never add payment
wording to any of these** (§L.7 flag, T&S #4).

A waiting ask **holds a place** (so a mentor's yes can never bounce). `GET /in-touch` items:
```jsonc
{
  "link_id": "…", "state": "in_touch",            // "asked" inside `waiting`
  "listener_id": "…",                             // → POST /listeners/{id}/request to write again
  "persona_name": "Quiet Banyan", "persona_avatar": "owl",
  "first_met_as": "Steady Cedar", "first_met_at": "…", "since": "…",
  "status": "online", "available": true,
  "categories": ["exam_stress"], "community_slug": "upsc",
  "public_line": "…", "availability_note": "…",
  "conversation_id": "…", "conversation_status": "ended", "stream_channel_id": "…"   // latest chat with them
}
```
`items` are oldest-link-first so the two rows never swap places. To **write to an in-touch
mentor**: open `conversation_id` when `conversation_status` is `active`; otherwise send a
Personal request to `listener_id` (existing flow). The "one open question" rule is not
built server-side, so nothing blocks this today.

After "not now" the member sees `state: "not_now"` with the ask disabled — quiet, no reason
exists anywhere. After the mentor *ends* a link, or the member takes an ask back, asking
again is allowed at once.

### Stay in touch — mentor (listener token)

| Call | Does | Answers |
|---|---|---|
| `GET /listener/me/stay-in-touch` | asks waiting for an answer (A15), oldest first | `[{id, member_persona_name, member_persona_avatar, companion_animal, companion_colour, conversation_id, asked_at}]` |
| `POST /listener/me/stay-in-touch/{id}/accept` | "Yes, stay in touch" — never takes a seat | `{"status": "in_touch"}` |
| `POST /listener/me/stay-in-touch/{id}/not-now` | quiet decline, no body, no reason | `{"status": "not_now"}` |
| `DELETE /listener/me/conversations/{id}/stay-in-touch` | end it with that chat's member; idempotent | `{"status": "ended"}` |

404 = not this mentor's ask (or already answered / taken back). 409 `member_full` cannot
happen in normal use (defensive). `GET /listener/me/conversations` items and the member
brief gain `in_touch: bool` — that is where the mentor's "end it" lives. **There is no
roster and no count of who stays in touch with a mentor, on purpose** (§L.6, T&S #5); do not
derive one in the UI. There is **no push** for an ask ("they will see it next time they are
here").

A member block or report, a mentor report, or an admin suspension ends the link (or the
waiting ask) server-side; the client only needs to refetch.

### Migrating off favourites

`POST|DELETE /listeners/{id}/favourite` and `is_favourite` still work and are marked
`deprecated` in OpenAPI. Client steps: (1) replace the profile's heart / "Ask for %{name}
next time" with the stay-in-touch ask; (2) replace the Browse "favourites" affordance with
the In touch chip driven by `in_touch`; (3) stop calling the favourite endpoints. Existing
favourites are **not** converted into links — a link needs the mentor's yes. Once no shipped
build calls them the endpoints and the table can go (a later migration).

---

## B3 — Product feedback (board A11)

### `POST /feedback` — member token **or** mentor (listener) token

```jsonc
// request
{
  "category": "broken",            // "broken" | "confusing" | "idea"  (A11's three chips)
  "text": "I could not tell whether my note was saved.",   // 1–1000 chars, trimmed
  "screen": "(tabs)/journals",     // optional, ≤ 64, the ROUTE TEMPLATE the sheet was opened from
  "app_version": "0.1.0 (35)"      // optional, ≤ 32
}
// 200
{ "status": "received", "crisis": null }
```

- `screen` must match `^[A-Za-z0-9_\-/\[\]().+]+$` — send the expo-router template
  (`chat/[id]`), **never** a path with a real id in it and never free text. 422 otherwise.
- The role (`member` / `mentor`) comes from the token. **No user id, listener id,
  conversation id, device or IP is stored** — A11 promises "We also note the screen name and
  app version. Nothing else." and "Your chats are never attached."
- Phone numbers / emails typed into the box are redacted before saving (same redactor as
  chat), so the team cannot reply to a note. Don't invite people to leave contact details.
- **Crisis words in the box:** the response is `200 {"status": "support", "crisis": {support,
  signal, helplines}}` — the same `crisis` payload a chat message carries. The sheet **must**
  show the helplines (reuse `CrisisCard`) instead of a thank-you. Those words are not kept
  as feedback; a signal-only safety flag goes to human review. This answer is never
  rate-limited.
- Errors: `401` no / unknown session (admin tokens are refused too) · `403` a mentor who is
  not approved · `422` bounds · `429` more than 5 an hour per author — `detail`: "Thank you —
  we have your notes. You can send more in a little while."
- **Not built: the screenshot** A11 draws ("This screen" thumbnail). There is no file
  storage in the API, and a screenshot of a chat would attach exactly what the sheet says is
  never attached. Leave the thumbnail out until that is ruled on.

### `GET /admin/feedback?limit=50&offset=0&category=&role=` — admin token

`limit` 1–100, `category` ∈ broken | confusing | idea, `role` ∈ member | mentor. Newest
first. Each read writes a `feedback.viewed` audit row.

```jsonc
{
  "total": 8, "limit": 50, "offset": 0,
  "items": [{
    "id": "…", "created_at": "2026-09-19T12:01:44+00:00",
    "role": "member", "category": "confusing",
    "text": "…", "screen": "(tabs)/journals", "app_version": "0.1.0 (35)"
  }]
}
```

---

## Deploy notes (all three units)

- Migrations, in order: `8c6073da268d` (message allowance) → `cf89dba30416` (stay in touch +
  rotating names) → `034abb526d75` (product feedback). All additive and safe under a running
  app. **Take a database backup first** (`deploy/backup-postgres.sh`), then `deploy.sh`.
- New env (all optional, defaults in `services/api/.env.example`): `ALLOWANCE_ENABLED`,
  `ALLOWANCE_ENFORCED` (**false** until the app renders A22), `ALLOWANCE_IN_A_ROW`,
  `ALLOWANCE_PER_DAY`, `ALLOWANCE_CRISIS_EXEMPT_HOURS`, `MENTOR_NAME_ROTATION_ENABLED`,
  `IN_TOUCH_LIMIT`, `IN_TOUCH_REASK_DAYS`.
- After the deploy, names are stamped on the first Browse read and **first change at the
  next 04:00 IST**. Tell the mentors before that morning.
- The dev uvicorn on :8000 runs without `--reload` — restart it to serve any of this.
