# Port the picked board screens to the app — plan (2026-09-19)

Source of truth: DECISIONS §L (rulings + picks). Board: "Mento — App Screens, Three Directions", row A. Branch: `feat/companions-dog-cat-capybara` (rename or merge before it grows further).

Rule for every unit (CLAUDE.md DoD): tokens + motion tokens only, PressKey/EdgeSurface, EN + HI via `t()`, `.web.tsx` parity where a split exists, `tsc --noEmit`, the touched flow driven at 390×844 normal + reduced with 0 page errors, a new/updated e2e, one conventional commit. **Expo must be watching files (not `CI=1`) or the proof is stale.**

## What can ship now vs what waits on the server

| Picked screen | Front-end only, now | Needs server work first |
|---|---|---|
| Journal — today first, then the shelf | Unified hub from existing channels (mentor notes + mood + gratitude), Finance → Coming soon | A plain **Note** type (`JournalChannel` is a DB enum → forward-only migration); one `GET /journals/entries` instead of three calls |
| Chat — header card + "In this chat" strip | Header card, presence ring, topic chip (from `mentorProfile`), **Saved N** (mentor notes filtered by conversation), save nudge line | **In touch** chip (§L.6–7), the **allowance meter** (§L.2) |
| Path — stage home, builder, finder | First-question builder (client-only; assembles text → `?starter=`), stage-centred home | New stages / Work route / question-style starters in `paths_data.py` (content from the private routes research — needs the partner's yes), stage-aware calendar cards |
| Request sent — the letter | The screen itself, shown after a Personal request is sent (today: the request state on `mentor/[id]`) | "Seen" state needs a `seen_at` on the request; one-open-question rule (§L.7) |
| My Chats — rows + In touch view | Richer rows (state chip, saved count, time), blocked-New-chat explainer once the rule exists | The **In touch** view, "first talked as", rotating names — all §L.6–7, not built |

## Units, in order

1. **Journal hub, unified (front-end only).** `app/(tabs)/journals.tsx`: Today card (kept guidance first, then the member's own entries, one-tap mood row), Past days shelf (horizontal), Kept guidance strip, quiet "Find the threads · Beta" link, Finance as Coming soon, Write key with quick types Mood · Gratitude. Per-channel screens stay as the writing surfaces. e2e: extend `member-screens` or add `journal-unified.e2e.js` (save from chat → appears in Today and in Kept guidance).
2. **Chat header card + strip (front-end only).** `components/chat/ChatScreen.tsx` + `.web.tsx` share a new `components/chat/ChatHeaderCard.tsx`; topic from `mentorProfile`, Saved N from mentor notes for this conversation; In touch chip hidden until unit 7. e2e: `two-party-chat`, `mentor-profile`.
3. **First-question builder (front-end only).** New route `app/path-question.tsx`; never auto-sends; hands the text to chat via the existing `?starter=` contract. e2e: extend `path-communities`.
4. **Path home around the stage + new routes (content + API data).** `paths_data.py` additions behind the partner's approval; tests in `test_paths.py` (tree leaves, no overlapping cards).
5. **Journal: Note type + single entries endpoint (API).** Migration adding `note` to the enum; `GET /journals/entries?since=`; pytest.
6. **Message allowance (API, test-required).** §L.2 in the before-send hook *after* the crisis scan, crisis-exempt, fail-open; admin counts; then the meter in the composer.
7. **Stay in touch + rotating names (API + both apps, spec first).** Request/accept model replacing favourites, cap of 2, stable "first talked as", name never re-issued while referenced; then the My Chats In touch view, the chat chip and the mentor sheet.
8. **Request sent — the letter.** After 7's one-open-question rule, so the screen tells the truth.
9. **Mentor side:** snooze, Reading 1 (text pending the partner), in-app feedback (own table; screenshots disabled on chat routes).

Not planned here: anything about a paid tier (flagged in §L.7, needs its own decision); directions B and C (parked).
