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
