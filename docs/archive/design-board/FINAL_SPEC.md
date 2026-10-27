# Mento board — THE FINAL CANVAS (2026-09-19)

The founder has picked direction A and asked for the finished board: **every screen of the app, beautifully made, in one design language, wired together so it plays as one seamless experience.** Rows B and C, the explorations and the bug boards are being cleared. You are building a set of the screens that do not exist yet in direction A. You write artboard files only — no publishing, rendering, screenshots, git or repo edits. Written is done.

Folder: `C:\Users\khana\AppData\Local\Temp\claude\C--Users-khana-Desktop-Mento\f2010876-83e7-45f1-9ba5-6b351b7be779\scratchpad\mento-design\`

## Read first
1. `SPEC.md` — the artboard FORMAT RULES (they fail silently).
2. `EXPLORE_SPEC.md` — direction A's exact design system (tokens, pillow keys, Baloo 2, washes), the product rulings, copy rules, companion art URLs, and how motion is written on this board.
3. The finished direction-A screens in `project/` that are nearest to yours — match them so closely that your screen could not be told apart as someone else's work: header pattern, paddings (44px top, 24px sides), key heights (56/58), radii (14 keys, 22 cards, 999 pills), the 4px bottom-edge pillow shadow, type sizes, tab bar. Best references: `A05_Chat`, `A06_Chats`, `A07_Path`, `A08_Journals`, `A09_Profile`, `A10_MentorHome`, `A14_StayInTouch`, `A11_Feedback` (a sheet), `A04_Connecting`. For state + handlers: `A12_MentorReading`, `A06_Chats`.
4. What the screen contains TODAY in the real app: look at the matching screenshot in `...\scratchpad\appmap\shots\` (use the Read tool on the .jpg — names are listed per screen below). Keep today's real content and purpose; redesign the look and feel into direction A. Where today's copy breaks a rule below, fix the copy.

## Non-negotiable copy and product rules
- The person on the other side is a **mentor**. Never "listener", "peer" (except the fixed footer line "Mentors are peers, not therapists."), "anonymous", "vetted", "therapist" as a claim, no clinical or diagnostic language. Say "private" instead of "anonymous". No emoji. No exclamation marks. Sentence case. Personas are `[Evocative] [Nature]` names (Steady Cedar, Quiet River, Soft Field, Bright Meadow). Never a real name, photo or "verified" badge.
- Mento is a guidance app with communities inside (UPSC is the first community, not the product). Tabs are **Chats · Path · Journal · Profile** ("Journal", singular).
- Money: contribution is opt-in, supports the *team*, never appears inside a conversation, never framed as membership. Never hint at a paid tier.
- No points, XP, streaks or scores anywhere. Reflection is private.
- Crisis, error and limit states are STILL: nothing animates, shakes or pulses on them. Crisis resources are exactly **Tele-MANAS 14416** and **KIRAN 1800-599-0019**, in a support-and-refer tone ("You deserve more support than a chat can give right now").
- Message allowance: 3 messages in a row, 10 per day; crisis-flagged messages are never blocked or counted.
- The member's companion is the star: use the Cat (idle `/_blob/c5932cbe7933051e63ca71be87e0d6f1`) as the member's companion unless your reference screen already uses another; mentors appear as a companion in a soft round avatar (Owl `/_blob/902f0cecc2f1387e57d248d962191f3e`, Fox `/_blob/3703bec182b52f2b5a88352c05afb95f`, others in EXPLORE_SPEC). Only use `/_blob/…` URLs that already appear in the spec files or in existing artboards — never invent one, never use a data: URI or external image.

## The arrival choreography — EVERY screen uses exactly this (this is what makes the board feel like one app)
Put this block in `<helmet><style>` verbatim, and put the classes on the elements. The sky, the tab bar, the back key and the companion get NO arrival class: they are simply already there, which is what reads as continuity when one artboard links to the next.
```css
@keyframes arr{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}
@keyframes arrSheet{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes arrDeep{from{transform:translateX(48px);opacity:0}to{transform:translateX(0);opacity:1}}
@keyframes arrDim{from{opacity:0}to{opacity:1}}
@keyframes breathe{from{transform:scale(1) rotate(-1deg)}to{transform:scale(1.035) rotate(0.8deg)}}
.key:active{transform:translateY(3px)}
@media (prefers-reduced-motion: no-preference){
.key{transition:transform 0.12s cubic-bezier(0.22,1,0.36,1)}
.arr{animation:arr 0.5s cubic-bezier(0.22,1,0.36,1) both}
.a1{animation-delay:0.08s}.a2{animation-delay:0.16s}.a3{animation-delay:0.24s}.a4{animation-delay:0.32s}.a5{animation-delay:0.40s}.a6{animation-delay:0.48s}
.arrSheet{animation:arrSheet 0.5s cubic-bezier(0.22,1,0.36,1) both}
.arrDeep{animation:arrDeep 0.5s cubic-bezier(0.22,1,0.36,1) both}
.arrDim{animation:arrDim 0.35s linear both}
.breathe{animation:breathe 5.2s ease-in-out infinite alternate}
}
```
- A **flow / tab screen**: content blocks get `arr` + `a1…a6` in reading order (headline first, primary key last). Max 6 steps, group the rest.
- A **sheet** (options, new chat, start fresh, line sheet): draw the screen it sits over faithfully but simplified, scaled back (`transform: scale(0.96) translateY(8px)`, border-radius 22px, static — it does not animate), a scrim `rgba(43,43,43,0.35)` with `arrDim`, the sheet with `arrSheet`, and its rows with `arr a2…a6`. The scrim is an `<a>` back to the underlying screen.
- A **deeper page** (reached from a row or card): its content column gets `arrDeep` once, then inner blocks `arr`.
- The companion uses `breathe` (transform-origin 50% 100%) and nothing else. Every pillow key / tappable gets class `key`.
- Crisis / limit / error blocks get NO animation class at all.
- Transform and opacity only. No bounce. Never animate layout.

## Wiring — the board is a click-through prototype
Every tappable that leads somewhere is a real `<a href="<File>.dc.html">` to the artboard below (it opens that artboard in Play). Things that change state on the same screen are real `<button onClick="{{ handler }}">` with state in the Component class. No dead primary actions: if the target is not listed, link to the nearest listed screen.

| File | Screen | Goes to |
|---|---|---|
| A01_Landing | Landing | Start → A02_RoleFork |
| A02_RoleFork | Ask a mentor / I want to mentor | talk → A16_AgeGate · mentor → A33_MentorPrimer · back → A01 |
| A16_AgeGate | Age gate (D/M/Y, 18+) | Continue → A17_Email · back → A02 |
| A17_Email | Optional email | Continue or Skip → A03_Companion · back → A16 |
| A03_Companion | Companion + colour pick | Continue → A18_Ready |
| A18_Ready | Your Mento space is ready | Enter My Space → A19_Connecting · back → A03 |
| A19_Connecting | Finding → Found (stateful, instant path) | auto/continue → A05_Chat · "nobody free" link → A04_Connecting |
| A04_Connecting | Request sent — the letter (reply-when-free path) | Go to My Chats → A06_Chats |
| A05_Chat | Chat | header → A14_StayInTouch · options → A20_ChatOptions · back → A06 |
| A20_ChatOptions | Conversation options sheet over the chat | scrim → A05 · End → A23_Reflection · Report → A05 |
| A21_ChatCrisis | Chat with the crisis card showing | back → A06 |
| A22_ChatAllowance | Chat with the allowance reached | Journal nudge → A08 · back → A06 |
| A14_StayInTouch | Mentor profile + ask to stay in touch | back → A05 |
| A23_Reflection | After End: private energy slider | Done → A06_Chats · "Tell us how this felt" → A11_Feedback |
| A11_Feedback | Feedback sheet | — |
| A06_Chats | My Chats (All / In touch) | row → A05 · new-chat key → A24_NewChatSheet · tabs |
| A24_NewChatSheet | New chat sheet over My Chats | Next available → A19_Connecting · Pick a mentor → A25_BrowseMentors · scrim → A06 |
| A25_BrowseMentors | Browse mentors (In touch first, filters, no ratings) | mentor row → A14_StayInTouch · back → A06 |
| A07_Path | Path home | starter → A27_QuestionBuilder · change path → A26_Pathfinder · tabs |
| A26_Pathfinder | Pathfinder (life first, then exams) | choose → A07_Path · back → A07 |
| A27_QuestionBuilder | First-question builder | Take it to a mentor → A19_Connecting · Edit in chat → A05 · back → A07 |
| A08_Journals | Journal hub (today, shelf) | Write → A28_JournalWrite · a past day → A29_JournalDay · Find the threads → A30_JournalThreads · tabs |
| A28_JournalWrite | Write an entry | Save → A08 · back → A08 |
| A29_JournalDay | One past day opened from the shelf | back → A08 |
| A30_JournalThreads | Find the threads (Beta, opt-in) | back → A08 |
| A09_Profile | Profile | Support the team → A31_Coffee · Start fresh → A32_StartFresh · Become a mentor → A37_MentorApplication · tabs |
| A31_Coffee | Support the team | back → A09 |
| A32_StartFresh | Start fresh sheet over Profile | Cancel/scrim → A09 · confirm → A01 |
| A33_MentorPrimer | Mentoring here, in plain words | Continue → A34_MentorHandoff · back → A02 |
| A34_MentorHandoff | Hand-off into the mentor side | auto/continue → A10_MentorHome |
| A10_MentorHome | Mentor Home (console) | conversation row → A35_MentorChat · Reading 1 → A12 · "I'd rather talk today" → A06 · not yet approved → A37 |
| A35_MentorChat | Mentor-side chat | header → A36_MemberBrief · back → A10 |
| A36_MemberBrief | Member brief (what the mentor may know) | stay-in-touch request → A15_StayInTouchMentor · back → A35 |
| A15_StayInTouchMentor | Mentor decides on stay in touch | — |
| A12_MentorReading | Mentor Reading 1 | back → A10 |
| A37_MentorApplication | Become a mentor: form + status states (stateful) | Submit → status state · back → A09 |
| A38_PublicApply | Public apply page (web, no app needed) | Apply → A37 |
| A39_NotFound | This road does not exist | Take me home → A06 |

Tab bar links (on the four tab screens): Chats → `A06_Chats.dc.html`, Path → `A07_Path.dc.html`, Journal → `A08_Journals.dc.html`, Profile → `A09_Profile.dc.html`. Copy the tab bar markup exactly from `A06_Chats`.

## Format reminders that bite
Exact `<script src="./support.js"></script>` head line; `<x-dc>` + `<helmet>`; root element `width: 390px; height: 844px; overflow: hidden; position: relative` and `$preview` 390×844 (A38 may be 390×844 too — it is a phone-first web page); inline styles for all layout; `{{holes}}` only in inline style values and `onClick`/`sc-if` attributes, only for names returned by `renderVals()`, never inside a `class` attribute, never an expression; the single tweak `accent` (default `#A2533A`, options `#A2533A #467054 #3B6D8F #6B4C8C`) with `accentEdge`/`accentTint` derived in `renderVals()` exactly as the reference artboards do; real `<button>`/`<a>`/`<input>`+`<label>`; `aria-label` on icon-only keys; touch targets ≥ 44px; text contrast ≥ 4.5:1 (use `#5E5A53` for secondary text, never lighter); inline stroke SVG icons (1.75 stroke), never emoji; no fake status bar; nothing clipped — check your vertical budget adds up to 844.

When finished reply with: files written, one line each on what the screen shows and links to; any rule you had to bend; anything in today's screen you deliberately dropped or changed, and why.
