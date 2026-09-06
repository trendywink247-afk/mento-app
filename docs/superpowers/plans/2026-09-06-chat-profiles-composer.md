# Chat profiles + composer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three chat pieces from `docs/superpowers/specs/2026-09-06-chat-profiles-composer-design.md`: the member-side mentor profile ("Two in the room"), the mentor-side member brief ("Context for care"), and the pillow-key composer on every chat surface.

**Architecture:** One Alembic revision adds two mentor-editable text columns, a conversation topic column and a favourites table. Five small endpoints (member profile-by-conversation + Browse profile, favourite on/off, mentor profile edit, member brief, admin clear-line) follow the existing router patterns and scoping dependencies. Mobile adds two routed screens, two header PressKeys, one console sheet, one composer component used by both kit `Channel`s, and restyles the two web composers. Every unit is proven with pytest / tsc / e2e before the next starts.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (forward-only), pytest (`requires_postgres`), Expo SDK 52 / expo-router 4 / stream-chat-expo 9.3.0, Playwright e2e scripts in `apps/mobile/e2e/`.

**Branch:** `feat/chat-profiles-composer` off `master`. Conventional commits with the session trailer:

```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01F4XFHcL8iqCMXe9yHyUpHj
```

**Standing rules (CLAUDE.md, non-negotiable):** design tokens via `useTheme()` only, tappables are `PressKey` (static cards `EdgeSurface`), strings via `useI18n().t()` with EN + HI keys, typed API clients only (`lib/api.ts`, `lib/listenerApi.ts`, `lib/adminApi.ts`), manual Reanimated shared values never `entering=`, every animation consults `useReducedMotion`, motion tokens only, `// reason:` on any rule break. Verify per touched layer (mento-verify): pytest → `alembic check` → **re-seed listeners**; `npx tsc --noEmit`; e2e at 390×844 with 0 page errors, normal + `reducedMotion: 'reduce'`.

**Run order / concurrency:** T1 → (T2 ∥ T3) → T4 → T5 → T6 → (T7 ∥ T8 ∥ T9) → T10. Parallel tasks touch disjoint files; each commits with path-scoped `git add`.

---

## File map

| Task | Creates | Modifies |
|---|---|---|
| T1 server foundations | `migrations/versions/<rev>_chat_profiles.py`, `app/models/favourite.py`, `app/services/categories.py`, `app/services/care_prompts.py`, `tests/test_care_prompts.py` | `app/models/listener.py`, `app/models/conversation.py`, `app/models/__init__.py` (export), `scripts/seed_listeners.py` (categories from the dict) |
| T2 member profile + favourites | `tests/test_mentor_profile.py` | `app/routers/listeners.py`, `app/routers/conversation.py`, `app/schemas.py` |
| T3 mentor edit + admin clear + topic persistence | `tests/test_listener_profile_edit.py` | `app/routers/listener_console.py`, `app/routers/admin_console.py`, `app/services/matching.py`, `app/schemas.py`, `tests/test_admin_console.py` |
| T4 member brief | `tests/test_member_brief.py` | `app/routers/listener_console.py`, `app/services/stream.py`, `app/schemas.py` |
| T5 mobile clients + strings + analytics | — | `lib/api.ts`, `lib/listenerApi.ts`, `lib/adminApi.ts`, `lib/analytics.ts`, `locales/en.json`, `locales/hi.json` |
| T6 composer | `components/chat/Composer.tsx` | `components/chat/ChatScreen.tsx`, `components/chat/ChatScreen.web.tsx`, `components/mentor/MentorChatScreen.tsx`, `components/mentor/MentorChatScreen.web.tsx` |
| T7 mentor profile screen | `app/mentor-profile/[id].tsx`, `components/chat/MentorProfileScreen.tsx`, `e2e/mentor-profile.e2e.js` | `components/chat/ChatScreen.tsx`, `components/chat/ChatScreen.web.tsx`, `components/chat/ConversationOptions.tsx`, `app/(tabs)/mentors.tsx`, `e2e/README.md` |
| T8 member brief screen + "Your line" | `app/mentor/member/[id].tsx`, `components/mentor/MemberBriefScreen.tsx`, `app/mentor/line.tsx`, `components/mentor/LineSheet.tsx` | `components/mentor/MentorChatScreen.tsx`, `components/mentor/MentorChatScreen.web.tsx`, `components/mentor/PresenceHeader.tsx`, `app/mentor/_layout.tsx`, `e2e/mentor-console.e2e.js` |
| T9 admin panel | — | `components/admin/panels/ListenersPanel.web.tsx` |
| T10 docs + ship | — | `PROGRESS.md`, `CLAUDE.md`, `docs/DECISIONS.md`, `README.md` |

---

## Task 1 — Server foundations: migration, models, categories, care prompts

**Files:** see map. Patterns: `app/models/listener.py` (mixins, enums), any `migrations/versions/*.py` (forward-only, hand-checked), `app/services/paths_data.py` (server data style).

- [ ] **Step 1: Models.** `ListenerProfile` gains `public_line: Mapped[str | None] = mapped_column(String(120), nullable=True)` and `availability_note: Mapped[str | None] = mapped_column(String(60), nullable=True)`. `Conversation` gains `issue_category: Mapped[str | None] = mapped_column(String(40), nullable=True)`. New `app/models/favourite.py`:

```python
class FavouriteListener(Base):
    __tablename__ = "favourite_listeners"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    listener_id: Mapped[str] = mapped_column(ForeignKey("listener_profiles.id", ondelete="CASCADE"), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
```
Export it wherever the other models are imported for Alembic autogenerate (`app/models/__init__.py` or `app/db.py` — follow the existing pattern).

- [ ] **Step 2: Migration.** `alembic revision --autogenerate -m "chat profiles: public line, availability note, issue category, favourites"`; open the file, confirm it contains exactly the 3 columns + 1 table (and nothing else); `alembic upgrade head`; `alembic check` → "No new upgrade operations detected."

- [ ] **Step 3: Categories dict.** `app/services/categories.py`:

```python
ISSUE_CATEGORIES: dict[str, str] = {
    "exam_stress": "Exam stress",
    "loneliness": "Loneliness",
    "family": "Family",
    "career_doubt": "Career doubt",
    "relationships": "Relationships",
    "life": "Life in general",
}
def label(slug: str | None) -> str | None: return ISSUE_CATEGORIES.get(slug) if slug else None
```
`scripts/seed_listeners.py` keeps its SEED tuples but every category slug used must be a key of `ISSUE_CATEGORIES` (assert at import).

- [ ] **Step 4: Care prompts.** `app/services/care_prompts.py`: `PROMPTS: dict[str, list[str]]` with a `general` list and one list per category key above (5 each, Calm register, second person, one sentence, never diagnostic — write them; spec §4.5 has the `exam_stress` five). `def pick(issue_category: str | None, seed: str) -> str` chooses `PROMPTS.get(issue_category, PROMPTS["general"])[int(hashlib.sha1(seed.encode()).hexdigest(), 16) % len(list)]` (sha1 so it's stable across processes; `hash()` is salted).

- [ ] **Step 5: Tests** `tests/test_care_prompts.py`: same seed → same prompt; unknown category → general; every list has ≥5 non-empty single-sentence strings; every seed category slug is in `ISSUE_CATEGORIES`.

- [ ] **Step 6: Verify + commit.** pytest green, `alembic check` clean, `python -m scripts.seed_listeners`. Commit `feat(server): chat-profile foundations — public line, availability note, issue category, favourites, care prompts`.

---

## Task 2 — Member side: profile by conversation, profile by id, favourites, Browse ordering

**Files:** `app/routers/listeners.py`, `app/routers/conversation.py`, `app/schemas.py`, `tests/test_mentor_profile.py`. Patterns: `list_listeners` + `_listener_out` in `routers/listeners.py`; ownership check style in `routers/conversation.py` (`_own_convo` or equivalent — read it).

- [ ] **Step 1: Schema** in `app/schemas.py`:

```python
class ListenerProfileOut(BaseModel):
    id: str; persona_name: str; persona_avatar: str; gender: str
    categories: list[str]; community_slug: str | None
    status: str; available: bool
    public_line: str | None; availability_note: str | None
    listening_since: str            # ListenerProfile.created_at date ISO
    conversations_held: int
    is_favourite: bool
```
`ListenerOut` (Browse) gains `is_favourite: bool`.

- [ ] **Step 2: Helper** `_profile_out(db, li, user_id) -> ListenerProfileOut` in `routers/listeners.py`: `conversations_held` = COUNT of `Conversation` where `listener_id == li.id` and status in (active, ended, wiped); `is_favourite` = exists `FavouriteListener(user_id, listener_id)`.

- [ ] **Step 3: Endpoints.**
  - `GET /listeners/{listener_id}` → 404 unless approved and not blocked/own (reuse `_blocked_listener_ids`/`_own_listener_ids`).
  - `POST /listeners/{listener_id}/favourite` and `DELETE …/favourite` → `OkResult`; idempotent (insert-if-missing / delete-if-present); 404 unless approved.
  - `GET /conversations/{convo_id}/mentor` in `routers/conversation.py` → `ListenerProfileOut` for the conversation's listener; 404 unless the conversation belongs to the caller (same opaque rule as the other conversation routes). Import the helper from `routers/listeners.py` (or move it to `services/listeners.py` if that avoids a circular import — implementer's call, keep it typed).
  - `GET /listeners`: set `is_favourite`, then order favourites first, then available first, then rank (stable).

- [ ] **Step 4: Tests** `tests/test_mentor_profile.py` (copy fixtures from `tests/test_listener_console.py`): profile by id 200 with correct counts/since; not-approved 404; blocked listener 404; favourite POST twice → one row, DELETE twice → 200 both; Browse favourites first and `is_favourite` true only for the caller; `GET /conversations/{id}/mentor` 200 for owner, 404 for another user; user delete cascades favourites.

- [ ] **Step 5: Verify + commit.** pytest, `alembic check`, re-seed. Commit `feat(api): mentor profile by conversation + Browse, favourite listeners`.

---

## Task 3 — Mentor edits their line; admin clears it; approval seeds availability; topic persisted

**Files:** `app/routers/listener_console.py`, `app/routers/admin_console.py`, `app/services/matching.py`, `app/schemas.py`, `tests/test_listener_profile_edit.py`, `tests/test_admin_console.py`. Patterns: `set_status` (rate limit + `current_listener`), `approve_application` (`ListenerProfile(...)` construction), `suspend_listener` (admin audit), `open_conversation`.

- [ ] **Step 1: Schema.** `ListenerProfileEditIn(BaseModel): public_line: str | None = Field(default=None, max_length=120); availability_note: str | None = Field(default=None, max_length=60)`. `ListenerMeOut` gains `public_line`, `availability_note`. Admin `AdminListenerItem` (whatever the Listeners panel row schema is called) gains `public_line: str | None`.

- [ ] **Step 2: `PUT /listener/me/profile`** → `ListenerMeOut`. Rate limit `listener-profile:{listener.id}` 10 / 3600. For each provided field: strip newlines (`" ".join(value.split())`), trim; empty → NULL. Omitted field = unchanged (PATCH semantics on a PUT is fine here; document it in the docstring).

- [ ] **Step 3: Approval seeds** `availability_note = application.availability.strip()[:60] or None` when minting the `ListenerProfile` in `approve_application`.

- [ ] **Step 4: Admin clear-line.** `POST /admin/listeners/{listener_id}/clear-line` → `OkResult`; sets `public_line=None`; `audit.record(db, admin, "listener.public_line_cleared", subject_type="listener", subject_id=…)`. Same role gate as suspend.

- [ ] **Step 5: Topic persistence.** `open_conversation` gains keyword `issue_category: str | None = None` and stores it on the `Conversation`. `match_general` passes its `category`; `accept_personal_request` passes `req.issue_category`.

- [ ] **Step 6: Tests.** `tests/test_listener_profile_edit.py`: save both fields → `/listener/me` reflects them; 121-char line → 422; newlines collapsed; empty string → null; suspended listener rejected (existing dependency); rate-limit key exercised (limits are off in tests via the autouse fixture — assert the enforce call is made with `monkeypatch` on `ratelimit.enforce`, as other tests do, or skip if no precedent exists). `tests/test_admin_console.py`: approve seeds `availability_note` from the application; clear-line nulls it and writes the audit row. In `tests/test_capacity_accounting.py` or a matching test: General match with `issue_category="exam_stress"` stores it on the conversation; Personal accept stores the request's category.

- [ ] **Step 7: Verify + commit.** Commit `feat(api): mentor public line + availability note (edit, admin clear, approval seed); persist conversation topic`.

---

## Task 4 — Member brief endpoint

**Files:** `app/routers/listener_console.py`, `app/services/stream.py`, `app/schemas.py`, `tests/test_member_brief.py`. Patterns: `my_conversations` (ownership query), `push._is_watching` (channel query with `state=True`, Redis cache with TTL, fail-soft), `paths_data` lookups in `services/paths.py`.

- [ ] **Step 1: Schema** `MemberBriefOut` exactly as spec §4.3.

- [ ] **Step 2: Stream helper** `stream.channel_last_message_at(channel_id: str) -> datetime | None`: `client.channel("messaging", channel_id).query(state=True)` → parse `channel["last_message_at"]`; cache the ISO string in Redis key `brief:lma:{channel_id}` for 30 s (cache the empty string for "none"); any exception → `None` and one `logger.warning`. Never returns message bodies.

- [ ] **Step 3: Endpoint** `GET /listener/me/conversations/{convo_id}/brief`: load the conversation with `listener_id == listener.id` else 404; load the member `User`; labels via `services/paths` (community + stage labels from `paths_data`) and `services/categories.label`; `safety_flags_open` = COUNT `SafetyFlag` where `conversation_id == convo.id and reviewed is False`; `member_masked = convo.status_mask is not None` (same rule `ListenerConversationItem` uses — read it); `care_prompt = care_prompts.pick(convo.issue_category, convo.id)`.

- [ ] **Step 4: Tests** `tests/test_member_brief.py`: own conversation 200 with companion + labels + prompt; unknown-slug community → labels null, no 500; another listener's conversation 404; unreviewed flags counted, reviewed excluded; Stream helper monkeypatched to raise → `last_message_at` null, still 200; same conversation → same `care_prompt` twice; masked member → `member_masked` true.

- [ ] **Step 5: Verify + commit.** Commit `feat(api): member brief for the mentor console (labels, care prompt, safety count, last message time)`.

---

## Task 5 — Mobile typed clients, strings, analytics

**Files:** `lib/api.ts`, `lib/listenerApi.ts`, `lib/adminApi.ts`, `lib/analytics.ts`, `locales/en.json`, `locales/hi.json`.

- [ ] **Step 1: `lib/api.ts`.** Types `ListenerProfile` (mirror `ListenerProfileOut`), `Listener` gains `is_favourite`. Functions: `mentorProfile(convoId)`, `listenerProfile(listenerId)`, `favouriteListener(listenerId, on: boolean)` (POST/DELETE).
- [ ] **Step 2: `lib/listenerApi.ts`.** `MemberBrief` type (mirror `MemberBriefOut`); `brief(convoId)`; `updateProfile({public_line?, availability_note?})`; `ListenerMe` gains the two fields.
- [ ] **Step 3: `lib/adminApi.ts`.** listener row type gains `public_line`; `clearListenerLine(id)`.
- [ ] **Step 4: Analytics.** Add `mentor_profile_viewed` (no props) and `mentor_favourited` (`{ on: boolean }`) to the closed union in `lib/analytics.ts`.
- [ ] **Step 5: Strings** (EN canonical, HI real translations, same keys) — add under existing namespaces:

```
chat.send                      "Send message"                          (a11y)
chat.mentorHeaderA11y          "View %{name}'s profile"
mentorProfile.online           "Mentor · online now"
mentorProfile.away             "Mentor · away"
mentorProfile.usually          "usually here %{note}"
mentorProfile.talkedWith       "Talked with %{count} people"
mentorProfile.since            "Listening since %{month}"
mentorProfile.sees             "Sees about you"
mentorProfile.seesValue        "persona only"
mentorProfile.pledge           "A real person, not a therapist. Vetted by the Mento team."
mentorProfile.askAgain         "Ask for %{name} next time"
mentorProfile.saved            "Saved · you'll see %{name} first"
mentorProfile.reportBlock      "Report or block"
mentorProfile.saveFailed       "Couldn't save — try again"
mentors.favourite              "Favourite"                              (heart a11y on Browse rows)
mentor.brief.title             "About this chat"
mentor.brief.memberHere        "Member · %{animal} in %{colour} · here now"
mentor.brief.memberAway        "Member · %{animal} in %{colour} · away"
mentor.brief.memberPlain       "Member · here now" / "Member · away"    (two keys: memberPlainHere, memberPlainAway)
mentor.brief.why               "Why they came"
mentor.brief.picked            "Picked %{topic} at match"
mentor.brief.lens              "Path lens %{lens}"
mentor.brief.firstMessage      "First message %{when}"
mentor.brief.started           "Chat started %{when}"
mentor.brief.inChat            "In this chat"
mentor.brief.lastMessage       "Last message"
mentor.brief.safety            "Safety flags"
mentor.brief.safetyNone        "none"
mentor.brief.safetyOpen        "%{count} · under review"
mentor.brief.nextStep          "A gentle next step"
mentor.brief.unavailable       "—"
mentor.line.row                "Your line"
mentor.line.title              "Your line"
mentor.line.body               "One sentence members see on your profile. Keep it about how you listen."
mentor.line.placeholder        "I sat the exam three times. I mostly just listen."
mentor.line.availability       "When you're usually here"
mentor.line.availabilityPlaceholder "evenings, weekends"
mentor.line.save               "Save"
common.retry                   (reuse if it exists; add if not)
```
Companion animal and colour display names: reuse the existing companion name keys from the onboarding picker (`onboarding.companion.*` or wherever `theme/companion.ts` labels live — find them, do not duplicate).

- [ ] **Step 6: Verify + commit.** `npx tsc --noEmit`. Commit `feat(mobile): typed clients, strings and analytics for chat profiles + composer`.

---

## Task 6 — Pillow-key composer (native both chats, web both chats)

**Files:** `components/chat/Composer.tsx` (new), `components/chat/ChatScreen.tsx`, `components/chat/ChatScreen.web.tsx`, `components/mentor/MentorChatScreen.tsx`, `components/mentor/MentorChatScreen.web.tsx`. Patterns: `components/chat/MessageText.tsx` (kit override + reasoning), `components/motion/PressKey.tsx`, `components/EdgeSurface.tsx`, `components/PrimaryButton.tsx`.

- [ ] **Step 1: Discover the kit seam.** In `node_modules/stream-chat-expo/src` find how `MessageInput` renders its input and which override names `WithComponents` / `Channel` accept in 9.3.0 (`Input`, `InputButtons`, `SendButton`, `MessageInput`). Choose the smallest override that replaces the visible input while keeping `useMessageInputContext()` (or `useMessageComposer()` — the screens already import it) for text/send/typing. Write the decision as a comment at the top of `Composer.tsx`.
- [ ] **Step 2: `Composer.tsx`** per spec §5.1: EdgeSurface pill field (`type.body`, `maxFontSizeMultiplier={1.3}`, multiline, max 4 lines = `maxHeight: 4 * type.body.lineHeight + vertical padding`, then scrolls), PressKey send circle (accent face, `accentEdge`, `arrow-up`), disabled look at 40 % opacity with `accessibilityState={{ disabled: true }}` when trimmed text is empty, `ActivityIndicator` while sending, `testID="composer-input"` / `"composer-send"`, a11y label `t('chat.send')`. Reduced motion → PressKey already handles travel; nothing else animates. No attach/emoji/command buttons. Enter = newline on native.
- [ ] **Step 3: Wire** into both native screens' `WithComponents overrides` (alongside `MessageText`) or `Channel` props — whichever Step 1 chose; keep `TypingIndicator`.
- [ ] **Step 4: Web** composers in both `.web.tsx` files restyled to the same anatomy and tokens; Enter sends, Shift+Enter newlines (unchanged); testIDs unchanged.
- [ ] **Step 5: Verify.** `npx tsc --noEmit`; reset env (mento-e2e) then `node e2e/two-party-chat.e2e.js` and `node e2e/mentor-console.e2e.js` (needs `MENTO_ADMIN_TOKEN`) green with 0 page errors. Confirm in the served web bundle that the kit's default input is gone (screenshot at 390×844 into the scratchpad, not the repo).
- [ ] **Step 6: Commit** `feat(chat): pillow-key composer on every chat surface (kit Input override + web restyle)`.

---

## Task 7 — Mentor profile screen (member side) + header tap + Browse hearts

**Files:** `app/mentor-profile/[id].tsx` (new, `id` = conversation id), `components/chat/MentorProfileScreen.tsx` (new), `components/chat/ChatScreen.tsx`, `components/chat/ChatScreen.web.tsx`, `components/chat/ConversationOptions.tsx`, `app/(tabs)/mentors.tsx`, `e2e/mentor-profile.e2e.js` (new), `e2e/README.md`. Patterns: `app/mentor/[id].tsx` (Browse profile: Screen + PersonaAvatar + chips), `components/art/Companion.tsx` (`awake`, `trigger`), `lib/useCompanionAnimal.ts`, `components/motion/Entrance.tsx`.

- [ ] **Step 1: Header PressKey.** In both `ChatScreen` files wrap avatar + name + status in `PressKey` (`testID="mentor-header"`, `accessibilityLabel={t('chat.mentorHeaderA11y', {name})}`) → `router.push({ pathname: '/mentor-profile/[id]', params: { id: conversationId, name: listenerName } })`. Face visuals in `style`, sizing in `containerStyle`.
- [ ] **Step 2: Screen** `MentorProfileScreen` per spec §3.2, data from `api.mentorProfile(convoId)`; shows the persona name from params immediately, then fills. Hero: `Companion` (member's animal via `useCompanionAnimal`, `awake`, size 120, one `curious` trigger after mount unless reduced) + `PersonaAvatar` 78 with online dot; name block; public line quote (only if non-null); chips (categories via `categories` labels — reuse the Browse chip labels; community label via the paths tree already loaded in the app, else the slug); facts as `EdgeSurface` rows; pledge caption; primary `PressKey` favourite toggle (optimistic, `capture('mentor_favourited', {on})`, revert + `mentorProfile.saveFailed` on error); ghost "Report or block" → `router.back()` after setting a one-shot param (`router.setParams({ openOption: 'report' })` on the chat route is unreliable across the stack — instead pass through a tiny module-level store `lib/pendingOption.ts` with `set('report')` / `take()`; ChatScreen reads `take()` on focus and opens `ConversationOptions` with `initial="report"`). `capture('mentor_profile_viewed')` on mount. Error state: still line + Retry; never blank.
- [ ] **Step 3: `ConversationOptions`** gains optional `initial?: 'report'` that opens straight onto the Report option.
- [ ] **Step 4: Browse hearts.** `app/(tabs)/mentors.tsx`: rows show a filled heart (Ionicons `heart`, accent) with a11y `mentors.favourite` when `is_favourite`; ordering comes from the server (favourites first) — remove any client re-sort that would undo it, keep the available/others split within each group.
- [ ] **Step 5: E2E** `e2e/mentor-profile.e2e.js`: onboard (copy `driveToReady` from `connecting-experience.e2e.js`) → chat-ready → click `mentor-header` → wait for the persona name + "Ask for … next time" → click → "Saved" text → back → open Browse (`chats` tab → new chat → pick, or navigate to `/mentors`) → first row has the heart. Normal + reduced-motion contexts, 0 page errors. Add to `e2e/README.md`.
- [ ] **Step 6: Verify + commit.** tsc; reset env; run the new spec; `connecting-experience.e2e.js` still green. Commit `feat(chat): mentor profile — two in the room (favourite, public line, report hand-off)`.

---

## Task 8 — Member brief (mentor side) + "Your line" sheet

**Files:** `app/mentor/member/[id].tsx` (new), `components/mentor/MemberBriefScreen.tsx` (new), `app/mentor/line.tsx` (new, `presentation: 'transparentModal'` like `report.tsx`), `components/mentor/LineSheet.tsx` (new), `components/mentor/MentorChatScreen.tsx`, `components/mentor/MentorChatScreen.web.tsx`, `components/mentor/PresenceHeader.tsx`, `app/mentor/_layout.tsx`, `e2e/mentor-console.e2e.js`. Patterns: `app/mentor/report.tsx` + `components/mentor/HelplinesSheet.tsx` (sheets), `lib/useMentorConsole.ts` (session guard, refresh), `lib/format.ts` (relative time — add `relativeTime(iso)` if missing).

- [ ] **Step 1: Header PressKey** in both `MentorChatScreen` files (`testID="member-header"`) → `router.push({ pathname: '/mentor/member/[id]', params: { id, member, masked } })`.
- [ ] **Step 2: `MemberBriefScreen`** per spec §4.2 from `listenerApi.brief(id)`: companion row (`Companion` with the member's `companion_animal` + accent from `companion_colour` via `theme/companion.ts`, `curious`, size 56; falls back to `PersonaAvatar` when null), caption keys `mentor.brief.member*`, "Why they came" `EdgeSurface` (rows hidden when null), "In this chat" list (last message relative or `—`; safety none / `n · under review`), prompt quote block, actions: ghost Helplines → `/mentor/helplines`, danger Report → `/mentor/report?id=`, ink End → the same end confirm the chat uses (extract it into a shared component if it's inline today). Session-lost → Mentor Home (guard from `useMentorConsole`). Error state: still + Retry.
- [ ] **Step 3: "Your line".** `PresenceHeader` gains a row "Your line" (`PressKey`, shows the current line truncated or the placeholder caption) → `/mentor/line`. `LineSheet`: two `TextInput`s (maxLength 120 / 60, `type.body`), Save (`PrimaryButton`, loading state) → `listenerApi.updateProfile`, on success `router.back()` and the console refreshes `me`; error line stays in the sheet.
- [ ] **Step 4: E2E** extend `mentor-console.e2e.js`: after the mentor opens a chat, click `member-header` → expect "Why they came" and "A gentle next step" → back; open "Your line", type a line, save → PresenceHeader shows it. Both contexts, 0 page errors.
- [ ] **Step 5: Verify + commit.** tsc; run `mentor-console.e2e.js`. Commit `feat(mentor): member brief — context for care; "Your line" editor`.

---

## Task 9 — Admin: show and clear the public line

**Files:** `components/admin/panels/ListenersPanel.web.tsx`.

- [ ] **Step 1:** each listener row shows `public_line` (italic caption, "—" when null) and a "Clear line" action (owner + helper, same gate as suspend) calling `adminApi.clearListenerLine(id)` then refetching. Confirm inline (no `<Modal>`).
- [ ] **Step 2:** tsc; load `/admin` in the browser with a dev owner token, clear a line on a seeded listener, see the audit row in the Admins tab. Commit `feat(admin): show + clear mentor public line`.

---

## Task 10 — Docs, PROGRESS, ship (controller, not a subagent)

- [ ] Final reviewer subagent over the whole branch (spec compliance against the design doc + quality).
- [ ] Merge to master; full verify (pytest, alembic check, re-seed, tsc, e2e set).
- [ ] CLAUDE.md: SCOPE §3/§5 mention profiles + favourites; repo layout lines for the new routes/components; Gotchas: the kit input override seam chosen in T6. DECISIONS: §K.13 recording the three picks and the six open decisions. README run-book unchanged unless a new script appears.
- [ ] Deploy API (backup → `deploy.sh`, migration runs on boot); rebuild + ship the web console (`deploy-console.sh`) for the admin panel; `eas update --branch preview` for the app; PROGRESS session entry; device proof of the composer on the Nothing Phone 1.

---

## Self-review notes

- Spec coverage: §3 → T2/T5/T7; §3.3 editor → T3/T8; §3.4 → T2/T7; §3.5 → T7; §4 → T4/T8; §4.5 → T1; §5 → T6; §6 → T1–T4/T9; §7 → T7/T8 error states; §8 → each task's tests; §9 → T10 DECISIONS.
- Names used consistently: `ListenerProfileOut`, `MemberBriefOut`, `ListenerProfileEditIn`, `api.mentorProfile / listenerProfile / favouriteListener`, `listenerApi.brief / updateProfile`, `adminApi.clearListenerLine`, `care_prompts.pick`, `categories.label`, `stream.channel_last_message_at`.
