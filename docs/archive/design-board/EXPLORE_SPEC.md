# Mento board — exploration round (direction A "Pillow"), 2026-09-19

You are designing phone screens for **Mento**, a guidance/mentorship app (members chat privately with volunteer mentors who have walked the same road; UPSC aspirants are the first community inside it). You write **artboard files** for a design canvas. You do NOT publish, render, screenshot or verify — you only write files. Written is done.

## Read these first (in this folder: `...\scratchpad\mento-design\`)
1. `SPEC.md` — the artboard FORMAT RULES (they fail silently — follow exactly) and the companion image URLs. Ignore its "Screen content" copy where this file says otherwise; ignore its "X = A/B/C" naming.
2. Exemplars of the house style, already approved — mirror their structure, tokens and quality:
   `project/A05_Chat.dc.html`, `project/A11_Feedback.dc.html`, `project/A14_StayInTouch.dc.html`, `project/A08_Journals.dc.html`, `project/A01_Landing.dc.html` (for how motion is written).

## Direction A design system (exact)
- One family: **Baloo 2** via `<link href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@400;600;700;800&amp;display=swap" rel="stylesheet">` inside `<helmet>`; fallback `'Trebuchet MS', system-ui, sans-serif`. Headline 26–30/36–40 w800 with ONE accent word in `{{accent}}`; title 22/28 w700; body 16/24; label 14/20 w700; caption 13/18.
- Colours: ground `#F4EFE6`; ritual ground `#EFE9DF`; surface `#FFFFFF`; surfaceAlt `#FBF8F2`; ink `#2B2B2B`; secondary text `#5E5A53` (use this, not lighter greys — contrast); border `#E6DFD3`; accent default `#A2533A`; success `#38734B` (text on green wash: `#2C5C3C`); danger text `#8E2F2A` on `#F8DEDC`. Pastel washes for icon badges: `#F6D9CB` `#E8DFF0` `#F5E8C4` `#DCE6DD` `#DCE8F2`.
- Depth = the **pillow key**: every tappable is a face with a SOLID darker underside, no blur: white faces `box-shadow: 0 4px 0 #E3DCCF` + `1px solid #E6DFD3`; alt faces `0 4px 0 #D9D1C2`; accent faces `0 4px 0 {{accentEdge}}`; ink faces `#2B2B2B` with `0 4px 0 #141414`. Static cards use the same edge at 3px. Blurred shadows ONLY on floating layers (tab bar pill, FAB, sheets).
- Radii: cards 22, keys/inputs 14, chips/pills 999. Spacing 4/8/12/16/24/32. Touch targets ≥ 44px.
- Script block: copy the `mix()` helper + `renderVals()` from the exemplars (returns `accent`, `accentEdge`, `accentTint`, `accentTintEdge` as needed). data-props: exactly one tweak `accent` (default `#A2533A`, options `#A2533A #467054 #3B6D8F #6B4C8C`) + `$preview` equal to the root size.
- Tab bar (where a screen has one): copy the floating white pill from `A08_Journals.dc.html`, links `A06_Chats / A07_Path / A08_Journals / A09_Profile`.
- The companion is physically part of layouts (perched on a card edge, peeking over the composer). Member = persona **Gentle Harbor**, companion **Fox**. Mentor = **Steady Cedar**, companion **Owl**.

## Extra art (use URL verbatim in `<img src>`, `object-fit: contain`, always `alt`)
Besides SPEC.md's list: Cat greet (HD, slim) `/_blob/c5932cbe7933051e63ca71be87e0d6f1` · Cat joy `/_blob/4f2efcf71291b5c16ffd4f80ab2a3e70` · Dog greet `/_blob/3bc70fffdaa6f2f10776977f9b130f77` · Capybara greet `/_blob/b47c4f3b8b5fa207fa454ab0a64791ba` · animated companions' playground loop (4:3, oat ground, use at 390×293) `/_blob/868d5c7e257ae7848b4b4f075d268499`.

## Product rulings you must honour (these changed the copy — do not reuse old lines)
- Never the words **anonymous**, **vetted**, **listener**, **therapist-as-a-role**; no emoji; no exclamation marks; no points, streaks, stars, ratings, badges, "verified". Say **mentor** and **member**. Privacy is worded "private" / "your identity is never shared".
- Somewhere appropriate the line survives: "Mentors are peers, not therapists."
- Connection promise: **right away if a mentor is online, otherwise a chosen mentor replies when they are free.** Never "in under a minute". Never promise a reply time you cannot keep — no "within an hour".
- Member message allowance: **up to 3 in a row** before the mentor replies, **10 per day**. A message flagged by the safety scan is never blocked — so a "limit reached" state must stay calm and still, keep the composer reachable, and never look like a punishment. Helplines stay one tap away (Tele-MANAS 14416, KIRAN 1800-599-0019).
- One question goes to **one mentor at a time**.
- Mentor names **rotate daily**; a member can **ask to stay in touch** and a mentor who agrees stays reachable under any name, shown as "Your mentor · you first talked as …".
- Saving: a member can save a mentor's message from chat; the app nudges "Important guidance? Save it to your journal so it stays with you."
- Finance journal is **Coming soon**. In-app **Feedback** entry exists on screens (small pill, top right).
- Contribution/coffee never appears inside a conversation. Error and limit states go STILL — nothing shakes or flashes at a struggling person.

## "Lively" — how motion is written here
The founder wants every screen to feel alive on iOS and Android. Do it in CSS inside `<helmet><style>`, as `@keyframes` + classes, and wrap EVERY animation rule in `@media (prefers-reduced-motion: no-preference){…}` so the default state is the finished, static layout. Rules: **transform and opacity only**; calm tempo (breathing 5.2s alternate, drifts 30–60s, entrances 0.6–0.8s with 80ms stagger, `cubic-bezier(0.2,0.7,0.2,1)`); no bounce/overshoot; at most ~4 things moving at once on a screen; entrance animations use `both` fill inside the media query only. Good material: staged entrance of cards, a breathing companion (`transform-origin: 50% 100%`), typing dots, a progress ring that draws, ripples from a "sent" point, a soft sheen across a hero card, chips that settle into place. Pressed feel for buttons: add `.key:active{transform:translateY(3px)}` style rules (class on the tappable) so keys physically travel when clicked in Play.

## iOS + Android resilience
Root is fixed 390×844, but build it to survive other phones: flex/grid + `gap`, no magic absolute positioning for content (decor only), text blocks that can wrap one more line, top safe area 44px and bottom 28px left clear, primary actions in the lower half (one-handed), no fake status bar, no fake keyboard, no fake home indicator.

## Output
Write each artboard with your file-writing tool to `...\scratchpad\mento-design\project\<FileName>.dc.html` (names given in your assignment). Each: root `width: 390px; height: 844px; box-sizing: border-box; overflow: hidden; position: relative`, own `<title>`, budget the heights so nothing clips (lists may run under a tab bar like a real scroll view). Real `<button>` / `<a href>` / `<input>`+`<label>`; `aria-label` on icon-only buttons; inline stroke SVG icons (1.75, round caps, `currentColor`). Variations must be GENUINELY different ideas (different structure/metaphor), not re-skins — and each must be beautiful on its own.
When finished reply with: the files written, a 2-line description of each variation's idea and its main trade-off, and any spec deviation (one line each).
