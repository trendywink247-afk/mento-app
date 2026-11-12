# Own chat vs Stream: parity

Updated 2026-11-12. Goal: own chat does everything Stream does, so Stream can be removed. Stream stays wired and working until the founder decides; nothing here changes the Stream path.

How the backend is chosen today: `Conversation.chat_backend`, set at match time from `OWN_CHAT_NEW_CONVERSATIONS` / `OWN_CHAT_USER_IDS` (default off, so new chats are Stream). Builds carry both `EXPO_PUBLIC_OWN_CHAT_*` flags (`ops/lib/build-env.sh`).

## Server (API)

| Feature | Own chat | Status |
|---|---|---|
| Send / receive, history, typing, read receipts, presence | WebSocket + REST (`routers/chat.py`) | Done |
| Crisis scan on every message, either side | `services/chat.py` stage 2, before storing | Done |
| Crisis flag retry when the flag write fails (Stream: message.new webhook) | `maintenance.crisis_reconcile`, every 5 min, signal only | **Added 2026-11-12** |
| Crisis health signal (Stream: webhook freshness) | `/health/crisis` → `own_chat.unflagged_backlog` (yes/no, never a count); `degraded` after 15 min | **Added 2026-11-12** |
| Mentor reply ends their snooze | `snooze.end_on_mentor_reply` matched only Stream ids | **Fixed 2026-11-12** (bug) |
| Allowance holds, redaction, Clean Wipe, report/block/suspend, push | Write path + `check_standing` | Done |
| Member list unread count | `unread_count` on `GET /conversations` (null for Stream, locked, wiped) | **Added 2026-11-12** |
| Mentor list preview | `last_message_preview` on `GET /listener/me/conversations` (null for Stream, wiped) | **Added 2026-11-12** |
| Ended chat transcript, both sides | `GET /chat/{id}/messages` (participants only; wiped reads empty) | Done (tests added) |
| Boot without Stream keys | Allowed only when own chat is on, no active Stream room, and `MESSAGE_KEY` is set | **Added 2026-11-12** |
| Moderation reader | `services/moderation_reader.py` (latest 100, decrypted) | Done |
| Export of own message text | Founder decision pending | Open |

## App and web

Tracked by the app-side change: unread dot in My Chats, mentor list preview, ended-chat transcript for mentor (native) and both web screens, web exam-redirect / suggest-certified / prepared answers, `ListenerConsole.web` opening own rooms, mentor console connecting to Stream only when a Stream room exists.

## Before Stream is removed

1. QA: `OWN_CHAT_NEW_CONVERSATIONS=true`, full two-phone and web run, everything green.
2. Founder review of the safety items (crisis scan, age gate, Clean Wipe, anonymity, safety ends).
3. Hard-cut Stream rooms, delete Stream's copy, then remove the code.
