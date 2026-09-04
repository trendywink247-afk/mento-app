# Native mentor console — design

**Date:** 2026-09-05 · **Status:** approved by founder in brainstorm (browser mockups `.superpowers/brainstorm/7147-1788561890/`) · **Supersedes:** DECISIONS §I.6 "web-only" (reversed by §K.7) · **Builds on:** `2026-09-04-role-fork-design.md` (Mentor Home is the console's front door).

## 1. Goal

An approved mentor answers chats **inside the app** — no browser hop, no pasted link. Parity with the web listener console (inbox of requests and conversations, accept/decline, online/away, real-time reply with the crisis card), plus a small mentor rail in the chat (helplines, report, end) and an honest-presence safety net. No push, no profile editing, no retirement of the web console in this phase.

Vocabulary: user-facing word is **mentor** (DECISIONS §K.1); routes, API paths, tables and code keep **listener**.

## 2. Founder rulings from the brainstorm

| Question | Ruling |
|---|---|
| Scope | Parity with the web console; push and profile editing stay out. |
| Credential handoff | Dedicated endpoint returns the listener JWT to the approved member session (no URL parsing, no deep link). |
| Structure | **A — one-screen home**: Mentor Home *is* the console; chat pushes on top; no mentor tab bar. |
| Chat | **B — parity + mentor rail**: not-a-therapist reminder, one-tap helplines, Report; header menu with Report and End. |
| Presence | Manual online/away toggle **plus** auto-away after 15 minutes without a heartbeat. |
| Thread implementation | stream-chat-expo kit (same as the member native chat); Focus physics stay web-only for now. |

## 3. Auth and session

**Server.** `POST /listener-applications/me/console-session` (member session auth). Loads the caller's application; requires `application.status == approved` **and** the linked `ListenerProfile.vetting_status == approved` (re-checked live, exactly like `console_url` today). Returns `ConsoleSessionOut { listener_token, listener_id, persona_name, persona_avatar, stream_token, expires_at }` using the existing `issue_listener_token` (30-day TTL). Otherwise 403 (`{"detail": "not_approved"}`). Rate limit 10/hour per user via `ratelimit.enforce`. The web console's `console_url` fragment link is unchanged.

**Device.** `lib/listenerSession.ts` gets the same `Platform.OS` branch as `lib/session.ts`: SecureStore on native, `localStorage` on web, key `mento.listener.session_token` (unchanged). Add `saveListenerSession`, `getListenerSessionToken`, `clearListenerSession`. `lib/listenerApi.ts` keeps the token in memory after load; on any 401/403 it clears the stored token and emits `listenerSessionLost` so Mentor Home drops back to the status state.

**Flow.** Mentor Home → application approved → no stored listener token → call `console-session` → store → render the console state. If the call 403s the mentor sees the status card ("approved, console unavailable right now") and a retry key; nothing is cached as trust. Start Fresh (`app/start-fresh.tsx`) clears the listener token with the rest. The member session and the local `Role` are untouched; `Role` never gates API access.

**Stream.** The console connects with a **separate** `StreamChat` instance (`lib/listenerStreamClient.ts`, already the pattern) using `stream_token`; never the member singleton. Disconnect on session loss and on Start Fresh.

## 4. Mentor Home as the console (structure A)

`app/mentor-home.tsx` states: `loading` · `noApplication` (inline `ApplicationForm`, unchanged) · `pending` · `declined` (reapply after the server-enforced cooldown, unchanged) · `console`.

`console` state layout (top → bottom), all tappables as `PressKey`, surfaces as `EdgeSurface`:

1. **Greeting** — mentor persona name, the mentor's companion (`Companion`), presence line "Online · 2 of 3 seats" / "Away", and the online/away toggle.
2. **Requests** — one card per pending Personal request: requester persona, category chip, intro message (full text, no truncation past 3 lines without a "more" expand), **Accept** (accent key) and **Decline** (ghost key). Accept 409 → inline note "You're at capacity — end a conversation before accepting another." Empty: one calm line ("No requests right now. Being online is enough.").
3. **Conversations** — active first, then ended. Row: member persona avatar + name, state line (`Typing…` / last message preview / `Masked · away right now` / `Ended`), unread pill from the listener Stream client's channel `unread_count`. Tap → `/mentor/chat/[id]`.
4. **Switch to talking** — unchanged behaviour (`saveRole('mentee')`, seed default companion if none).

Data: `GET /listener/me`, `GET /listener/me/requests`, `GET /listener/me/conversations` (existing). Refresh on focus, on pull-to-refresh, and requests re-poll every 30 s while focused. Previews and unread come from Stream channel events (`message.new`, `message.read`), not polling. Loading, error (still, dimmed, retry key) and empty states for each section. All copy via `useI18n().t()` (EN + HI).

## 5. Chat and the mentor rail

Route `app/mentor/chat/[id].tsx`, platform-split (`.tsx` native, `.web.tsx` web) like `app/chat/[id].tsx`, so stream-chat-expo never enters the web bundle.

**Native** `components/mentor/MentorChatScreen.tsx` on the stream-chat-expo kit (`Chat` with the listener client, `Channel`, `MessageList`, `MessageComposer`), inside the app-wide `OverlayProvider` that `AppProviders.native.tsx` already supplies.

- **Header**: back, member persona avatar + name, category, and a chip: `Masked` (member enabled Panda Mask) or `Away` (member paused) or nothing. Right side: `⋯` menu → Report, End.
- **Messages**: kit rendering; a custom message wrapper renders `CrisisCard` once per flagged message id (server-injected `crisis` payload; the client never scans). Persona names on both sides. Read state and typing from the kit.
- **Mentor rail** (above the composer, `EdgeSurface`): "You're a listener, not a therapist." + **Helplines** key → sheet with Tele-MANAS 14416 and KIRAN 1800-599-0019 as tap-to-dial (`Linking.openURL('tel:…')`), copy re-verified per `docs/PRIVACY.md` sourcing + **Report** key.
- **Report**: transparent-modal route (pattern `app/start-fresh.tsx`, never RN `<Modal>` on Android) with a reason picker (`abuse`, `harassment`, `spam`, `other` + optional note ≤ 300 chars) → `POST /listener/me/conversations/{id}/report`. Success: still confirmation, conversation stays open (moderation decides).
- **End**: confirm sheet ("End this conversation? The member will see it ended.") → `POST /listener/me/conversations/{id}/end`, then pop to Mentor Home with the seat freed.
- Error states go still (dim + retry); nothing shakes or buzzes.

**Web** `components/mentor/MentorChatScreen.web.tsx` = today's `ListenerChatScreen.web.tsx` plus the rail and the header menu, so the web console reaches parity as a later task of the implementation plan, after the native path is proven. The old `app/listener/*` routes keep working and are pointed at the shared components.

Motion: transform/opacity only, tokens from `theme/motion.ts`, reduced motion honoured; the rail and sheets use the standard `StepTransition`/sheet patterns already in the app.

## 6. Presence

- Toggle is manual: `PATCH /listener/me/status` (existing), now rate-limited 30/10 min per listener.
- **Heartbeat**: while Mentor Home (console state) or a mentor chat is focused **and** status is `online`, the app calls `POST /listener/me/heartbeat` every 5 minutes (and once on focus). Server stamps `ListenerProfile.last_seen_at`. Rate limit 30/10 min per listener.
- **Sweep**: `services/matching.sweep_stale_presence(db)` sets `status = away` for profiles with `status == online` and `last_seen_at < now − 15 min` (or `NULL` when created before this feature and never heartbeated since setting online). Called (a) lazily at the start of General matching (`find_available_listener` path) and (b) by the admin Health panel's existing reconcile action. Returns the count for audit.
- The device learns it was swept on the next focus refresh; the presence line reads "Away — you were away a while" with a one-tap **Go online**.
- App background/foreground: no special handling beyond "heartbeats stop when not focused"; the 15-minute window is the contract.

## 7. Server changes

| Change | Detail |
|---|---|
| `POST /listener-applications/me/console-session` | §3. Member auth. 403 unless application + profile both approved. 10/h per user. |
| `ListenerProfile.last_seen_at` | `DateTime(timezone=True)`, nullable; forward-only Alembic revision; `alembic check` clean. |
| `POST /listener/me/heartbeat` | Listener auth (`current_listener`, live vetting check). Stamps `last_seen_at`. 30/10 min. |
| `sweep_stale_presence` | §6. Unit-tested; wired into matching + admin reconcile. |
| `POST /listener/me/conversations/{id}/report` | Listener auth; conversation must belong to this listener (404 otherwise, opaque). Creates a `ModerationEvent` with `reporter_kind = listener`, `reporter_listener_id`, reason enum, note; **no member identity** in the payload beyond the conversation id. Audit row. 10/h per listener. |
| `POST /listener/me/conversations/{id}/end` | Listener auth + ownership. Reuses the member end path's seat release under the same `FOR UPDATE` lock; marks who ended it (`ended_by` enum `member|listener|system`, added to `Conversation` if absent — same migration as §7 row 2). Idempotent on already-ended. |
| Stream upsert on approval | `listener_applications` approve path and admin "create listener" both call `services.stream.upsert_listener_user`, closing the session-22 gap. |
| `PATCH /listener/me/status` rate limit | 30/10 min per listener. |

All rate limits fail-open on Redis error, never silently (existing `ratelimit.py` contract). Pydantic models in/out; no new PII fields.

## 8. Mobile file plan

- `lib/listenerSession.ts` — platform-branched storage.
- `lib/listenerApi.ts` — `consoleSession()` (member-auth call lives in `lib/api.ts`), `heartbeat()`, `report()`, `end()`; session-lost handling.
- `lib/listenerStreamClient.ts` — unchanged pattern; add `disconnectListenerClient()` used by Start Fresh and session loss.
- `lib/useListenerHeartbeat.ts` — focus-aware 5-minute heartbeat hook.
- `app/mentor-home.tsx` — console state; `components/mentor/{PresenceHeader,RequestCard,ConversationRow}.tsx`.
- `app/mentor/chat/[id].tsx` (+ `.web.tsx`), `components/mentor/MentorChatScreen.tsx` (+ `.web.tsx`), `components/mentor/MentorRail.tsx`, `app/mentor/report.tsx` (transparentModal), `components/mentor/HelplinesSheet.tsx`.
- `locales/en.json` + `hi.json` — new `mentor.console.*` keys.
- `app/listener/*` — thin wrappers over the shared web components (no duplicate chat renderer).
- `e2e/mentor-console.e2e.js`.

## 9. Testing

**Pytest (tested-before-merge list applies: routing, listener-console auth/scoping, matching):**
- console-session: 200 for approved application + approved profile; 403 for pending/declined/suspended profile; token round-trips through `current_listener`.
- suspension mid-session: token issued, profile suspended, next `/listener/me` → 403.
- heartbeat stamps `last_seen_at`; sweep flips stale online → away and leaves fresh ones; General matching skips swept listeners; admin reconcile reports the count.
- report: creates a moderation event scoped to the listener's own conversation; another listener's conversation → 404; payload carries no member id.
- end: frees the seat under concurrency (extend `test_matching_concurrency.py`); idempotent; other listener → 404.
- Stream upsert called on approval and admin create (mocked client).

**Mobile:** `npx tsc --noEmit`. New `e2e/mentor-console.e2e.js` (web, 390×844, 0 page errors, normal + reduced motion): role fork → apply → approve via admin API → Mentor Home shows the console → toggle online → a member (second context) sends a Personal request → Accept → open chat → rail visible → send a reply → member sees it → Report sheet opens and files → End frees the seat. Existing `role-fork.e2e.js` and `two-party-chat.e2e.js` re-run green.

**Native:** hand-proven on Expo Go (stream-chat-expo does not run under react-native-web): console renders, chat sends/receives, crisis card renders, helplines dial, Report/End work, patches in `apps/mobile/patches/` untouched.

## 10. Out of scope (logged, not built)

Push notifications (device registration for mentors + send trigger), mentor profile editing, retiring or auto-deploying the web console, Module B mentor naming, Focus physics on native.

## 11. Docs to update when shipped

CLAUDE.md SCOPE item 13 (no longer "web-only … nothing more") and the repo layout (`components/mentor/`, `app/mentor/`); DECISIONS §K.9 entry with the six rulings above; PROGRESS session entry; `docs/PRIVACY.md` note that mentors can file reports (no new data class).
