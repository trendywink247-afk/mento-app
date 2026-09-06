# Chat profiles + composer — design

**Date:** 2026-09-06 · **Status:** draft for founder review · **Source rulings:** founder picked, from the mockup page of 2026-09-06, **B "Two in the room"** for the mentor profile, **B "Context for care"** for the mentee profile, and (by "continue") the recommended **A "Pillow key"** composer. Admin console operations additions (conversations view / end on behalf, edit listener, push health) are **out of scope here** and get their own spec.

Source-of-truth order applies: DECISIONS → PRD → mockups. Anonymity integrity (T&S #7) is a hard constraint on every field below.

---

## 1. Goal

Three gaps in the chat, all visible on the founder's device:

1. Tapping the mentor in a member's chat does nothing. It should open a profile that makes the relationship feel personal, in the member's own companion frame, and let the member find that mentor again.
2. Tapping the member in the mentor console does nothing. It should open a short brief that helps the mentor listen better, without revealing anything the member wasn't told the mentor sees.
3. The native chat input is the Stream kit default and the only part of the chat not drawn in Mento's design language. It should be the same pillow-key material as every other tappable.

## 2. Non-goals

- No real names, photos, ratings, or ranks anywhere (T&S #7). No age, email, DOB, phone.
- No message previews in either profile.
- No attachments, images, GIFs, commands, or voice in the composer (SCOPE §3: text + emoji).
- No starter chips in the composer (option B) and no feeling row (option C) — logged as follow-ups.
- Admin console changes beyond what §6 needs for moderation of the mentor's public line.

---

## 3. Mentor profile — "Two in the room" (member side)

### 3.1 Entry and route

- The member chat header (`components/chat/ChatScreen.tsx` and `.web.tsx`) becomes a `PressKey` around avatar + name + status, `testID="mentor-header"`, accessibility label "View Serene Brook's profile".
- Tap pushes `app/mentor-profile/[id].tsx` with params `id` (listener id) and `convo` (conversation id). It is a normal stack push (hardware back returns to the chat). The Browse profile `app/mentor/[id].tsx` is unchanged; the two screens share `PersonaAvatar` and the topic-chip component only.

### 3.2 Layout (390×844, top to bottom)

1. Back chevron (standard `Screen` header).
2. **Hero:** the member's companion (`Companion` with `pose="idle"`, `awake`, size 120, their accent) at left, the mentor's `PersonaAvatar` (size 78, online dot) at right, bottoms aligned. Companion animal/colour come from the member's session; if the member has no companion (should not happen post-onboarding) the hero shows the avatar alone, centred.
3. **Name block, centred:** persona name (`type.displayHeadline`), caption "Mentor · online now" / "Mentor · away" + availability note if set ("· usually here evenings").
4. **Public line** (only if set): the mentor's own sentence, quoted, `type.body`, left rule in the accent wash. Never a placeholder when empty.
5. **Topic chips:** categories (accent wash) then community lens (sage wash, label from the paths tree).
6. **Facts list** (EdgeSurface rows): "Talked with N people" (conversations held, `count ≥ 1`, else row hidden), "Listening since {Month YYYY}", "Sees about you · persona only".
7. **Pledge line** (caption): "A real person, not a therapist. Vetted by the Mento team."
8. **Actions:** primary `PressKey` "🧡 Ask for {name} next time" (toggles to "Saved · you'll see {name} first" with heart filled once favourited); ghost "Report or block".

Motion: standard `Entrance` stagger on mount; companion `curious` trigger once when the screen settles; reduced motion = static.

### 3.3 Data

New endpoint `GET /conversations/{id}/mentor` → `ListenerProfileOut` (keyed by the **conversation** the member is in: the chat route only knows the conversation id and persona name, and the server derives the listener, so listener ids never need to travel through route params; 404 unless the conversation belongs to the caller). The same `ListenerProfileOut` is also served by `GET /listeners/{id}` for Browse:

```
id, persona_name, persona_avatar, gender, categories: list[str], community_slug: str | None,
status: "online" | "away", available: bool,
public_line: str | None, availability_note: str | None,
listening_since: str (ISO date of approval — ListenerProfile.created_at),
conversations_held: int (COUNT conversations where listener_id = id and status in active|ended|wiped),
is_favourite: bool (for the calling member)
```

- 404 for unknown / not-approved listeners. Requires a member session. Rate limit: none beyond global.
- `conversations_held` counts wiped conversations too: the count is about the mentor's experience, not about any member's content.

**New columns on `listener_profiles`:**

| column | type | rule |
|---|---|---|
| `public_line` | `VARCHAR(120) NULL` | written by the mentor only; plain text; server strips newlines and trims; empty string stored as NULL |
| `availability_note` | `VARCHAR(60) NULL` | same editor; **seeded at approval** from `ListenerApplication.availability` (truncated to 60) because that answer was written for this purpose |

The application's `motivation` stays admin-private. It is never auto-published.

**Mentor edits their line** in the app console: `PresenceHeader` gains a "Your line" row → transparentModal sheet with two fields (line ≤120, availability ≤60), save via `PUT /listener/me/profile` (`ListenerProfileEditIn{public_line?, availability_note?}`), rate-limited 10/h per listener. The web token-link console does not get the editor (fallback surface, DECISIONS: not grown).

**Admin moderation:** the Listeners panel shows `public_line` on each listener row with a "Clear line" action → `POST /admin/listeners/{id}/clear-line`, audit event `listener.public_line_cleared`. No pre-approval: the line goes live on save. Open decision §9.1.

### 3.4 Favourites

New table `favourite_listeners(user_id FK users, listener_id FK listener_profiles, created_at)`, primary key `(user_id, listener_id)`.

- `POST /listeners/{id}/favourite` (idempotent) and `DELETE /listeners/{id}/favourite` (idempotent), member session; 404 if the listener is not approved.
- `GET /listeners` (Browse) adds `is_favourite: bool` and returns favourites first, then the existing ordering. Browse rows show a small filled heart on favourites. Nothing else changes in v1 (no "favourites only" filter, no matcher preference — the matcher stays General-first; Personal requests already let a member pick).
- Start Fresh / account wipe deletes the rows (FK `ON DELETE CASCADE`).
- Clean Wipe does not touch favourites: the favourite is about the mentor, not the conversation.

### 3.5 Report or block

The ghost button opens the existing `ConversationOptions` sheet on the chat with the Report option pre-selected: `router.back()` then the chat reads a one-shot `openOption=report` param. No new report path; the moderation event still carries the conversation id.

### 3.6 Analytics

Add to the closed union: `mentor_profile_viewed` (no properties), `mentor_favourited` (`{on: boolean}`). Never the listener id.

---

## 4. Mentee brief — "Context for care" (mentor side)

### 4.1 Entry and route

- The mentor chat header (`components/mentor/MentorChatScreen.tsx` and `.web.tsx`) becomes a `PressKey`, `testID="member-header"`.
- Tap pushes `app/mentor/member/[id].tsx` (`id` = conversation id), full screen, listener session required (`useMentorConsole` guard, session-lost → Mentor Home).

### 4.2 Layout

1. Back chevron.
2. **Row:** the member's companion (`Companion`, `curious`, size 56, in the member's accent) + persona name (`type.displayHeadline` scaled) + caption "Member · {Animal} in {Colour} · here now / away" (`member_masked` → "away").
3. **Why they came** (EdgeSurface): "Picked **{topic label}** at match" (hidden when no topic), "path lens **{community} · {stage}**" (hidden when no community), "first message {relative time}" (falls back to "chat started {relative time}" when there is no message yet).
4. **In this chat** (list rows): "Last message · {relative}" · "Safety flags · none" or "{n} · under review" (see §4.4).
5. **A gentle next step** (quote block): one prompt from the care-prompts list (§4.5).
6. **Actions:** ghost "Helplines" → existing `/mentor/helplines`; danger "Report" → existing `/mentor/report?id=`; ink "End" → existing end flow with its confirm sheet.

What is deliberately **not** shown: Quiet Pause state (the member chose to go quiet; the mentor just sees silence — open decision §9.2), lock/PIN state, saved-to-notes counts, anything from other conversations, age, email.

### 4.3 Data

New endpoint `GET /listener/me/conversations/{id}/brief` → `MemberBriefOut`:

```
persona_name, persona_avatar,
companion_animal: str | None, companion_colour: str | None,
community_slug: str | None, community_label: str | None,
journey_stage: str | None, journey_stage_label: str | None,
issue_category: str | None, issue_category_label: str | None,
created_at: ISO, last_message_at: ISO | None,
member_masked: bool,
safety_flags_open: int,
care_prompt: str
```

- Scoped exactly like the other console endpoints: 404 unless the conversation belongs to the calling listener (opaque not-found). Suspended listeners are rejected by the existing dependency.
- `last_message_at` comes from Stream (`channel.query()` state → `last_message_at`) with a 30 s Redis cache per conversation; on Stream error it is `null` and the row reads "Last message · —". Never the message.
- Labels resolve server-side: community and stage from `paths_data`; issue category from a new `services/categories.py` dict (`exam_stress`, `loneliness`, `family`, `career_doubt`, `relationships`, `life` → display labels) that the seeds and the Browse topic chips also read, so no surface carries its own copy. Note: today the General match sends no `issue_category` (only Personal requests may), so most briefs will show the path lens but no topic until the member flow sets one; wiring a topic into General match is a separate follow-up.

**New column** `conversations.issue_category VARCHAR(40) NULL`, set by `open_conversation` from the General match payload or the Personal request's `issue_category`. Backfill: none (historic rows read as no topic).

### 4.4 Safety flags

`safety_flags_open` = COUNT of `SafetyFlag` rows for this conversation with `reviewed = false`. The mentor already sees the crisis card inline when a message flags, so a count is not new information; it exists so the brief is honest when a flag was raised while the mentor was away. Copy: "none" / "1 · under review" / "n · under review". Never the matched terms.

### 4.5 Care prompts

`app/services/care_prompts.py`: a dict `issue_category → list[str]` (5 prompts each) plus a `general` list; `pick(issue_category, seed)` returns one prompt deterministically from `hash(conversation_id)` so the same chat always shows the same prompt (a brief should not fidget). Tone: Calm register, second person, one sentence, never diagnostic. Content is server data like Path prompts — English only in v1 (chat/server content is untranslated per CLAUDE.md i18n row). Example set for `exam_stress`:

- "Ask what one small thing would make tomorrow lighter."
- "Ask when they last felt like themselves, even for an hour."
- "Reflect back the exact words they used for the pressure."
- "Ask what they've already tried, and notice the effort."
- "Ask who else knows how heavy it feels right now."

### 4.6 Analytics

None. Console usage is not member behaviour, and the event union stays member-only.

---

## 5. Composer — "Pillow key"

### 5.1 Native (both kit `Channel`s: member chat and mentor chat)

New `components/chat/Composer.tsx` rendered as the kit's input, supplied the same way `MessageText` is (via `WithComponents overrides` — the implementer verifies whether `Input` is accepted on `Channel` in stream-chat-expo 9.3.0 and uses whichever the kit honours; the result must be proven in the served bundle on device, not on disk).

It uses the kit's `useMessageInputContext()` for `text`, `setText`, `sendMessage`, `sending`, and the typing signal, so typing indicators, read state and the before-send crisis webhook stay exactly as today.

Anatomy (bottom of the screen, above the keyboard, safe-area bottom inset):

- **Typing line** (kit `TypingIndicator`, unchanged) above the row.
- **Field:** `EdgeSurface` pill — `surface` face, `edgeSurface` underside, radius 22, min height 44, horizontal padding 14. `TextInput` in `type.body` (Baloo 2, 16/24), colour `ink`, placeholder `chat.placeholder` in `inkMuted`, multiline, grows to **4 lines** then scrolls, `maxFontSizeMultiplier={1.3}` (same reason as `MessageText`). No attach, image, command, or emoji buttons; the system keyboard supplies emoji.
- **Send:** `PressKey` circle 44, accent face + `accentEdge`, `arrow-up` icon in `onAccent`. Empty text → face at 40 % opacity, no edge travel, not pressable (`accessibilityState.disabled`). Press-in → pillow travel + impact haptic (existing PressKey behaviour). While `sending` the icon swaps for the calm `ActivityIndicator`.
- Gap 8 between field and send; row padding 10 sides / 8 top / 12 bottom + inset.

Behaviour: Enter inserts a newline on native (send is the button). Send trims; empty/whitespace never sends. After send the field clears and keeps focus. Reduced motion: no travel, opacity-only state changes ≤150 ms.

### 5.2 Web

`ChatScreen.web.tsx` and `MentorChatScreen.web.tsx` composers restyled to the same anatomy with the same tokens. Enter sends, Shift+Enter newlines (web convention, unchanged from today). `testID`s stay `composer-input` / `composer-send` so the e2e suite keeps working.

### 5.3 Strings

`chat.placeholder` stays ("Say what's on your mind…" EN, existing HI). New: `chat.send` a11y label "Send message" (EN + HI).

---

## 6. Server summary

| Change | Where |
|---|---|
| Migration: `listener_profiles.public_line`, `listener_profiles.availability_note`, `conversations.issue_category`, table `favourite_listeners` | one Alembic revision |
| `GET /listeners/{id}`, `POST/DELETE /listeners/{id}/favourite`, `GET /listeners` adds `is_favourite` + favourites-first | `routers/listeners.py` |
| `PUT /listener/me/profile` | `routers/listener_console.py` (+ rate limit 10/h) |
| `GET /listener/me/conversations/{id}/brief` | `routers/listener_console.py` |
| `POST /admin/listeners/{id}/clear-line` + audit | `routers/admin_console.py` |
| `open_conversation` stores `issue_category`; approval seeds `availability_note` | `services/matching.py`, `routers/admin_console.py` approve path |
| `services/care_prompts.py` | new |
| Stream `last_message_at` lookup with 30 s cache | `services/stream.py` |

Push, crisis scan, matching and rate-limit behaviour are untouched.

---

## 7. Error and empty states

- Profile/brief fetch fails: the screen renders the header from the params it already has (persona name) and a still error line with Retry; never a blank page. Errors go still (T&S #11).
- Favourite toggle fails: button reverts, caption "Couldn't save — try again" for one beat; no shake.
- Public line save fails: sheet stays open with the error line.
- Brief: Stream unreachable → "Last message · —"; DB fine.

---

## 8. Testing

Server (pytest, on the tested-before-merge list because it touches listener-console scoping and routing):
- `GET /listeners/{id}`: approved only; `conversations_held` and `listening_since` correct; `is_favourite` per caller.
- Favourite: idempotent POST/DELETE; Browse orders favourites first; cascade on user delete.
- `PUT /listener/me/profile`: length limits, newline stripping, suspended listener rejected, rate limit path.
- Brief: own conversation 200 with labels; another listener's conversation 404; `safety_flags_open` counts unreviewed only; `issue_category` set by General match and by Personal accept; Stream failure → `last_message_at: null`.
- Admin clear-line writes the audit row; helper vs owner scoping as the panel already enforces.
- `alembic check` clean; listeners re-seeded.

Mobile: `tsc --noEmit` clean. E2E (390×844, 0 page errors, normal + reduced motion):
- `mentor-profile.e2e.js`: onboard → chat → tap header → profile shows name, topics, "Ask for … next time" → toggle → back → Browse shows the heart first.
- `mentor-console.e2e.js` extended: tap member header → brief shows companion caption, "Why they came", a prompt; actions route.
- `two-party-chat.e2e.js` still green with the restyled web composer.
- Device: composer proven on the Nothing Phone 1 via OTA (bubble text not clipped, 4-line growth, disabled send).

---

## 9. Open decisions (founder veto in PROGRESS)

1. **Public line goes live without pre-approval;** admin can clear it, and clearing is audited. Alternative: hold for approval (adds a queue nobody staffs yet).
2. **Quiet Pause is not surfaced to the mentor.** The member chose silence; the brief shows the last-message time only.
3. **Safety flag count is shown mentor-side** ("n · under review"). It duplicates the inline crisis card but keeps the brief honest.
4. **The composer drops the emoji button** (system keyboards have one). Web users have their OS picker.
5. **Favourites affect Browse ordering only**; no matcher preference and no "favourites" filter in v1.
6. **`availability_note` is seeded from the application answer** at approval; the mentor can edit it afterwards.
