# Mento — PRD ↔ Mockups Reconciliation & Decisions

**Date:** 2026-06-08 · **Updated:** 2026-07-11 (§I — motion, mascot, listener console) · **Owner:** Arieddin Sheik · **Status:** Final (Option A)

**Authority:** This document resolves every conflict between `Mento_PRD_v2.md` and the 64 UI mockups. **Where this doc disagrees with either the PRD or the mockups, this doc wins.** Claude Code must read `PRD_v2` *and* this file at the alignment step and resolve nothing by guessing.

---

## Workspace and release environments — founder ruling, 2026-10-02

Development now uses only `H:\Mento gpt` (repository `H:\Mento gpt\Mento`);
the Desktop copy is not touched. Prove changes locally first, then validate releases
on VPS staging before staged production deployment. Use both existing VPSs for
production, isolated staging, and monitoring with explicit resource and data
boundaries. Operational contract and current blockers: `docs/ENVIRONMENTS.md`.
This changes delivery environments, not the v1 product scope.

## Positioning decision (governs everything below)

Mento is an **anonymous emotional-support app**. UPSC is the **first community**, not the product. Mentor-led UPSC *sessions* (PRD Module B) are **build-second**, after the anonymous chat (Module A) is solid. The UPSC **self-assessment** suite (Self-Reflection, The Mirror, Knowledge Assessment, Preparation Challenges) is **deferred** to a later, separately-specced module.

The hero experience is anonymous 1:1 chat — "I just need to talk." Anything in the mockups that serves UPSC coaching or self-diagnosis is **out of v1 scope** unless it also serves the emotional-support core.

---

## A. Direct conflicts — resolved

1. **Visual system.** *Mockups win.* Build the polished **light-mode v1** (indigo brand from the mockups), not the PRD §4 grey/white test build. → PRD §4 and §18 are stale (see §F).
2. **Auth / friction.** *PRD + mockups win.* No phone, no password, no name. **Optional Gmail/email only**, used for recovery + PIN reset. **Drop mandatory phone OTP from the user path.** Keep MSG91/phone *only* if mentors must be phone-verified (Module B, deferred). → correct the build playbook's "phone OTP via MSG91" line.
3. **Post-chat points / "earned a coffee."** *PRD principle wins* (§3 anti-dependency; §8.4 "coffee" supports the team, it is **not** a currency or the listener's pay). Keep a light post-conversation **reflection** (capture a takeaway → save to journal). **Cut or rename "earned a coffee"** and fully decouple any points from the contribution concept.

---

## B. Identity model — resolved (surfaced on close review)

The mockups mix two models: anonymous personas ("Purple Valley," "Silent Mountain," "Guide Within") **and** real identities ("Aisha · Verified Mentor" + photo, "Nirav").

4. **Hero chat = anonymous personas only.** Both sides get an auto-assigned persona (evocative nature noun + abstract/scenic avatar). **No real names, no real photos, no "Verified Mentor" badge** in the v1 anonymous chat. (PRD §6.1, §2 Module A.)
5. **Real mentor profiles** ("Verified Mentor," photo) belong to **Module B** (UPSC specialization mentoring) and ship **with that deferred module** — they must not appear in the v1 emotional-support chat.
6. **One naming convention.** Standardize on the "[Evocative] [Nature]" persona style used across most screens (Purple Valley, Silent Mountain, Study Companion, Guide Within). Retire "Listening Panda," real first names, and photos from anonymous chat. The **growth-companion** (animal + colour) is *separate* personalization/theme and is **never** the chat handle.

---

## C. Navigation / information architecture — resolved (surfaced on close review)

The mockups contain two different bottom navs: (1) `Chats · Journals · Mentors · Profile` (4 tabs); (2) `Home · Mentors · Mirror · Chats · Profile` (5 tabs, promoting the UPSC "Mirror" to a primary tab).

7. **Use the 4-tab, chat-first nav: `Chats · Journals · Mentors · Profile`.** Chats is the default landing for returning users (PRD §5: the dashboard is effectively the conversation). **Do not promote "Mirror"/self-assessment to a primary tab** — it's deferred. Revisit IA only when Module B + the assessment module ship.

---

## D. In the mockups, not in the PRD — scope calls

8. **UPSC self-assessment suite (Mirror / Knowledge Assessment / Preparation Challenges).** *Defer.* Spec as its own module later; do not build by default.
9. **Conversation PIN-lock + biometrics.** *v1-optional; simplify.* Don't stack numpad + email-reset + fingerprint in one state. Adds friction, not MVP-critical; keep it behind the conversation-options menu.
10. **"Panda Pause" (per-conversation mute/snooze).** *Keep* — it's the PRD's mute affordance, themed. Fine as drawn.
11. **Journals expanded 2 → 4.** Keep the **AI Journal Assistant** (= PRD §12 conversational logging agent — confirmed). Core channels: **Finance** (= PRD Expense Tracker), **Mood** (= daily/emotional channel), **Mentor Notes** (= the save-to-journal destination from chat). **Gratitude** is optional. Keep each simple per PRD ("carry over, don't rebuild").

---

## E. In the PRD, not in the mockups — build regardless

12. **Crisis / helpline flow (PRD §10 — non-negotiable).** Across all 64 screens there is only a "you're not alone" footer. **Build the real flow:** trigger scan → surface India resources (Tele-MANAS / KIRAN, verify current numbers at build) → switch tone to support-and-refer → flag for a human. Design these screens.
13. **"Save to journal" from a chat message (PRD §6.2).** The destination ("Mentor Notes") exists; the **action** (long-press a mentor message → save) was not drawn. **Build it** — it's the core talk→action loop.
14. **General (instant-match) + Personal (pick a mentor) routing (PRD §6.3).** Both paths exist in the mockups (the "Connect to a Mentor / next available" screen = General; the mentor-profile "Connect with Purple Valley" = Personal). Under Option A, **broaden the topic chips back toward life/emotional categories** (family, relationships, self-esteem, loneliness, focus) rather than the UPSC-only set (Prelims/Mains/Interview Guidance).
15. **Fix the age/DOB picker.** The mockup picker reads "18 Years / 05 Months / 2002 Year" — internally contradictory. Build a correct **Day / Month / Year** date-of-birth picker, compute age server-side, enforce the minimum-age gate (PRD §10).

---

## F. Stale PRD sections to update (say the word and I'll patch them)

- **§4** (grey/white MVP) → replace with light-mode v1 scope.
- **§18** (timeline / 10–20 testers) → reflect the v1 ambition.
- **§6.1** (persona) → add the one-convention rule + the Module A/B identity split (§B).
- **§12** (journals) → 2 → the channel set in §D.11.
- **§15** (tech stack) → auth correction: no user-path phone OTP.

---

## G. Still open — your call (PRD §20 carryovers)

- Final issue-category names (now life/emotional-leaning per §E.14).
- Under-18: block entirely at MVP? (PRD recommends yes.)
- Crisis-helpline list: confirm current India numbers at build.
- Real-time layer: WebSocket vs managed (Stream Chat) for fastest MVP. → **Resolved H.0: Stream Chat.**
- Listener training: minimum viable curriculum.

---

## H. Founder rulings — 2026-06-08 (the three flags, resolved)

**0. Realtime layer.** Use **Stream Chat** (managed) for v1 speed.

**1. Payments.** **Drop the ₹399/599/999 subscription tiers entirely** — they contradict the PRD and Option A. **Razorpay is the processor only.** The v1 money surface is the **transparent coffee/tip** from the mockups (**₹49–₹499 chips + open ceiling**, custom amount), framed as **supporting the team** — never gated, never required, **never inside a conversation**. Module B session fees come later, with that module.

**2. Storage / "Panda Wipe".** **Keep Stream Chat.** The "Panda Wipe" copy **must match reality**: reword to an **honest deletion promise — deletes from your device AND our servers** — and implement a **real server-side delete-on-wipe** (Stream message + channel deletion). **Do not claim on-device-only / "we don't store your messages" anywhere** while Stream is the backend. The privacy policy must match the actual data flows (PRD §14).

**3. Auth / OTP.** **No phone in the user flow.** **Optional email only**, used for recovery. **MSG91 phone verification is reserved for mentors** in the deferred Module B. (Confirms A.2.)

**Build directive:** after the PRD patch, proceed to the first build slice — **onboarding → anonymous match → live chat**, with the **crisis-scan stub wired in from day one.**

---

## I. Founder rulings — 2026-07-11 (motion phase, mascot, mentor side)

Context: v1 Module A was fully built (see `PROGRESS.md` sessions 2–10); the founder then directed a "movie-like" UI/UX phase that must **exceed** the mockups, and surfaced two gaps — the mascot quality and the absence of any real mentor-side surface.

**1. Cinematic motion, NO 3D engine.** The premium feel comes from motion, depth, light and a living character (the Calm/Headspace/Finch register) — **not** a 3D engine, which would break the <2s cold start, mid-Android 60fps, <40MB binary, and the calm support ethos. Onboarding first (it is the 30-second promise); the same motion language extends to other surfaces later.

**2. Onboarding is ONE route.** Shared-element transitions are not production-viable on Expo SDK 52 + expo-router, so filmic continuity comes from a **single journey route** (`apps/mobile/components/onboarding/OnboardingJourney.tsx`) hosting an internal step machine over a persistent ambient background + persistent mascot. Deep links via `?step=`; old routes are redirect stubs. The onboarding/match **API flow is byte-identical** — this is presentation architecture only.

**3. Ambient layer = Skia SkSL aurora.** `@shopify/react-native-skia` 1.5 (the SDK 52 pin, ~3–5MB native) renders one full-screen shader; a static SVG gradient always paints the first frame (cold-start guard and permanent fallback); web lazy-loads CanvasKit at idle and degrades to the gradient on failure. **Picking a companion colour washes the whole sky** — the signature moment. No Skia blur on Android.

**4. Mascot: the hand-drawn SVG rig is INTERIM.** The coded panda (layered SVG + Reanimated blink/breathe/wave) does not meet the mockups' character bar. Professional **reactive** character assets will be sourced — research memo first (`docs/MASCOT_ASSETS.md`), **founder decides before any purchase or integration**. Rive (state-machine reactivity) is preferred if its missing react-native-web runtime is acceptable; Lottie (.lottie, playback-only) is the fallback. Hard requirement: **one consistent style across all six animals** (panda, elephant, fox, turtle, deer, owl).
   → **Resolved 2026-07-11 (founder): staged commission.** Commission the **reactive Rive set** ($2.5–6k tier, brief in `docs/MASCOT_COMMISSION_BRIEF.md`); ship the **free Lottie interim** meanwhile. All companion rendering goes through one `Companion` component so the Rive swap is an internal change.
   → **Amended same day (founder): no Rive specialist available to commission.** The **in-house coded reactive rig** (layered SVG + Reanimated, full state vocabulary: idle/breathe, greet, celebrate, comfort, tap-react) becomes the v1 mascot route, applied to all six animals behind the same `Companion` component. The commission brief stays on file for whenever a specialist is found; the Lottie registry stays as an optional drop-in.
   → **RETIRED 2026-07-13 (founder): no commission budget.** The in-house rig + AI-generated art set (session 13) + the 2.5D depth system (session 17 `Tilt3D`) is the **permanent** v1 character route — not an interim. Free-asset upgrades (Lottie/open-licence packs) remain welcome behind the `Companion` component; no paid commission is planned or required.

**5. The chosen animal is the star.** From the moment the user picks their growth companion, **their animal — not a fixed panda — carries the companion identity everywhere** (onboarding stage, ready celebration, matched moment, profile). The panda remains the *brand guide* only before the choice is made. This extends B.6: companion = personalization/theme, never the chat handle.

**6. Minimal listener console ships in v1.** A real human must be able to answer chats before Module B. Scope: **web-only console, per-listener token-link auth (no password), see own conversations, reply in real time, accept/decline own Personal requests, toggle online/away.** Explicitly NOT: mentor profiles, payments, MSG91 verification, profile editing, push — those remain Module B. Anonymity holds on both sides (listeners see member *personas* only), and the crisis card renders listener-side so the listener knows what helplines the member was shown. The global-admin-token accept/decline stays for moderation/ops.

**7. Sensory scope: visual + haptics, NO audio.** A designed haptic vocabulary (selection tick on choices, light impact on step advance, success on match — `apps/mobile/lib/haptics.ts`) and nothing audible: someone opening a support app in public must never fear sound. All motion respects reduce-motion (system setting on native, `prefers-reduced-motion` on web) — the flow must be fully usable with every animation stripped.

---

## J. Founder rulings — sessions 17 & 22 (communities-as-lens, listener-application funnel)

Context: shipped ahead of this document on direct founder instruction; ratifying here so DECISIONS.md matches what's actually live (per `CLAUDE.md` SCOPE §15–16 and `PROGRESS.md`).

**1. Communities are a lens, never a gate (session 17).** The UPSC-first framing from earlier sections (Positioning decision, §A–I) is superseded for navigation: a **Pathfinder → community lens** picker (upsc/neet/jee/exams/life) replaces any single-community assumption. Community + journey stage are server-driven (`GET /paths/tree`, `GET/PUT/DELETE /paths/me`), deliberately **coarse, optional, and clearable** — never a hard gate, and it must never strand a user unmatched (community is the strongest **soft** matcher preference only). Starter prompts pre-fill the composer via `?starter=` and **never auto-send**.

**2. Bottom nav retires the 4-tab `Chats · Journals · Mentors · Profile` set (§C.7, superseded).** The shipped nav is **`Chats · Path · Journals · Profile`** — Path replaces the primary Mentors slot; Mentors/Browse becomes hidden-but-routable (reached from within Chats/Path flows), not a primary tab. This does not reopen the door to promoting UPSC self-assessment ("Mirror") to a tab — §D.8 defer ruling still stands.

**3. In-app become-a-listener funnel (session 22).** Recruitment moves in-app: Profile → application (motivation, communities, availability, optional email, hard-gated "not therapists" pledge) → admin Applications queue (approve mints a real listener + audit row; decline stores an admin-private reason, 30-day server-enforced reapply cooldown) → in-app status card. A `mentor_interest` flag stages interest for the deferred Module B mentor portal without building any of Module B now. Application emails are **stored, not sent** — no email provider is wired yet; that choice stays open (tracked in `CLAUDE.md` → Docs drift until a provider is picked).

---

## K. Founder rulings — 2026-09-04 (session 30: v1 navigation finalised)

Context: full screen audit (24 route files, 45 rendered states walked at 390×844, 0 page/console errors) ahead of finalising UI navigation. Four calls put to the founder via structured question; answers ratified here and shipped in `63534be`.

**1. The user-facing word is "mentor".** The person on the other side of a v1 chat is a **mentor** in every member-facing string (EN + HI): landing, connecting, chat header, Path counter, Profile safety card ("Mentors, not therapists"), the become-a-mentor funnel and the public `/apply` page. "Listener" survives only as the **internal/code/ops term** — routes (`/listener-apply`, `/listener`), testIDs, API paths, DB tables, the listener console and admin panel names are unchanged. Trust & Safety rule #2 ("listeners are not therapists") keeps its meaning under the new word. Note: this reserves nothing for Module B's *paid* mentors — when Module B ships, its naming must be revisited (open).

**2. New Chat never mints a conversation on its own.** The Chats FAB opens a two-option sheet — *talk to whoever's free now* (General match) or *choose a mentor* (Browse) — instead of instantly creating a second live conversation. Rejected: instant match with a confirm; FAB-to-browse only.

**3. Legacy onboarding stub routes deleted; branded not-found added.** `onboarding/{age,email,companion,ready,connecting}` (redirect stubs from §I.2) are gone — `?step=` deep links on `/onboarding` remain the only deep-link surface. `app/+not-found.tsx` replaces expo-router's default black "Unmatched Route" page with a calm, companion-led screen and a single way back.

**4. Landing hero stays the two-people illustration.** The companion becomes the star from the age step onward (§I.5 unchanged); the landing does not switch to a default panda. Rejected: companion-led landing.

**5. Visual revamp direction chosen — "Clay and Sage, illustrated" (2026-09-04, same session).** Three AI-rendered concept directions (Morning Paper / Night Sky / Clay and Sage) and four blends were generated on Higgsfield (Nano Banana, 1 credit each, 37 credits total) and reviewed side by side on a shared artifact page. Founder ruling: **Clay and Sage's palette and surfaces** — oat `#F4EFE6` ground, sage `#9DB5A1` + terracotta `#D98C6B` accents, deep charcoal ink, matte clay cards with soft shadows, bold rounded geometric sans — **but the companion animals stay soft 2D storybook illustrations** (the Midnight Paper treatment), *not* 3D clay figures. Consequences: the in-house illustrated companion rig (§I.4) carries over unchanged in style; tokens (`theme/tokens.ts`), the companion accent set (`theme/companion.ts`) and the Lottie palette bake need re-deriving from the new palette; type moves from Nunito+Lora to a single rounded geometric sans (face TBD, must ship Devanagari coverage). Concept renders are reference, not pixel specs — the Calm register, motion rules and reduced-motion guarantees are unchanged.

**6. Typeface for the revamp: Baloo 2 (2026-09-04).** Two candidates with Devanagari in the same family were rendered live (real fonts, not AI) on Mento screens in the chosen palette — Baloo 2 and Poppins. Founder chose **Baloo 2** as the single family for display, body and buttons. It replaces both Nunito and Lora and retires the Lora-has-no-Devanagari fallback (`app/_layout.tsx`, `theme/tokens.ts` `font`). Noto Sans Devanagari stays loaded only as a platform fallback.

**7. Role fork after landing + Mentor Home (2026-09-04).** A "What brings you here today?" step becomes step zero of the onboarding journey: **I need to talk** (mentee, unchanged path) or **I'm here to listen** (mentor → primer → anonymous session without a match → new **Mentor Home** route hosting the application form / status / console link, with an "I'd rather talk today" switch). Choice is remembered on device, cleared by Start fresh, never sent to the server. Layout ruling: **two doors** (over a segmented switch or a split scene). Spec: `docs/superpowers/specs/2026-09-04-role-fork-design.md`. **Also ruled: a native mentor console in the app is wanted** — this reverses §I.6's web-only stance for a later phase; it gets its own spec and does not ship with the fork. Mentor Home is designed as that console's future front door.

**8. Fidelity pass rulings (2026-09-05, browser mockups).** Depth language: **pillow key** — every tappable surface has a visible bottom edge that collapses on press, medium impact haptic on press-in (rejected: soft clay, quiet matte). Companion art: **painterly** — fur texture, rim light, real volume, still an illustration (rejected: storybook flat, soft-3D film). Chat: **Focus** — physics only (rising bubbles, breathing typing dots, pressing send key), no ambient scene and no companion inside the chat (rejected: living sky, scene header). Build order: foundation first (tokens, type, PressKey primitive, chat physics) then the companion asset pipeline; all six animals, one reference + six poses each (~52 credits approved). Spec: `docs/superpowers/specs/2026-09-05-fidelity-pass-design.md`. Implementation note (session 31b): accent values were deepened from the concept renders so white labels and accent text pass WCAG AA on white, oat and the ritual surface (gate: `scripts/contrast_gate.py`); the light concept terracotta survives as `accentSoft`/tints; ghost keys sit on `surfaceAlt`; the Logo stays a fixed brand mark. Companion pipeline note (session 31c): the painterly set shipped for all six animals (46 credits, `scripts/companions/manifest.json`), and the legacy `Panda` component is now an adapter onto `Companion` that renders the **user's chosen animal** in the requested pose — closing the §I.5 "fixed panda" exception flagged in session 30's audit. Accepted trade-off: the terracotta scarf is painted in and does not follow the companion accent.

**9. Native mentor console (2026-09-05, browser mockups).** Scope: parity with the web console, no push, no profile editing. Credential handoff: a dedicated `POST /listener-applications/me/console-session` returns the listener JWT to the approved member session (rejected: parsing `console_url`, deep links). Structure: **A — one-screen home** (Mentor Home *is* the console; chat pushes; no mentor tab bar). Chat: **B — parity + mentor rail** (not-a-therapist line, one-tap helplines, Report; header menu Report/End). Presence: **manual toggle + auto-away** after 15 minutes without a heartbeat. Thread: stream-chat-expo kit on native. Spec `docs/superpowers/specs/2026-09-05-native-mentor-console-design.md`. Implementation note (session 31d, server half): `last_seen_at` is stamped only by the heartbeat and reset to NULL when a listener goes online, so seeded and web-console listeners (no heartbeat yet) are never swept; mentor reports carry `reporter_kind=listener` and never end the chat; `Conversation.ended_by` records member/listener/system. Mobile half (session 31e): shipped — Mentor Home renders the console once `console-session` mints a credential (SecureStore on device), the chat runs on the stream-chat-expo kit natively and on the shared hand-rolled thread on web (both with the rail), Report/End/helplines sheets are transparentModal routes; proven by `e2e/mentor-console.e2e.js`. Web console (token-link) now shares the mentor chat and gains the rail; it still does not heartbeat (never auto-away) — open.

**10. Push notifications (2026-09-05, terminal brainstorm).** Audience: **mentors and members**. Member triggers: **conversation events only** — accepted, reply — no check-ins, no nudges, no streaks (T&S #5). Content: **persona name only**, never a preview or body (public-place safety). Away detection: **Stream channel watchers** — a recipient watching the channel gets no push. Architecture: send from the existing verified Stream `message.new` webhook and the request endpoints via **Expo's push API** as FastAPI background tasks; no queue, no worker (rejected: Stream's own push integration — would default to message text; a Redis worker — over-built at pilot scale). Crisis-flagged messages push like any other message and never anything extra. Spec `docs/superpowers/specs/2026-09-05-push-notifications-design.md`.

**11. Companion-neutral feature names (2026-09-05).** The chosen animal is the star (§I.5), so features stop wearing the panda's name: **Panda Pause → Quiet Pause**, **Panda Mask → Away Mask**, **Panda Wipe → Clean Wipe** (EN + HI, CLAUDE.md, README, PRIVACY). Code identifiers, testIDs and API paths are unchanged; historical docs (PRD, mockup inventory, older DECISIONS entries) keep the old names. Also ruled: both of the founder's approved mentor profiles (Serene Brook, Purple Maple) stay for two-role testing. Session 31g.

**12. No free mentor is never a dead end (2026-09-06).** Founder: "even if no listener is available it should take the mentee to homepage and can browse mentors he can send req to." When General match still 503s after the honest retries, the connecting step offers **Browse mentors instead** beside Try again (the session already exists), landing on the Mentors screen so a Personal request can be sent. Server side, the matcher now **self-heals** before answering 503: the capacity reconcile (end chats older than `conversation_max_age_hours` = 24 h, recompute counters, presence sweep) runs inline and the pick is retried once if anything was freed — prod had every slot held by day-old abandoned test chats. Open: whether an *idle* (not merely old) chat should release its slot sooner. Session 32.

**13. Chat profiles + composer (2026-09-06, mockup page).** Founder picked **B "Two in the room"** for the mentor profile (member taps the chat header: their companion beside the mentor's persona, the mentor's own public line and availability note, topics, "talked with N people", "listening since", **Ask for {name} next time** = favourites, favourites first in Browse), **B "Context for care"** for the member brief (mentor taps the header: companion in the member's colour, path lens + match topic, chat start + last-message time, an honest **open safety-flag count**, one server-side care prompt, Helplines / Report / End), and the recommended **A "Pillow key"** composer (EdgeSurface field + accent PressKey send, no attach/emoji buttons, both native kit chats via an `Input` override and both web chats). Calls made without a question, veto in PROGRESS: the mentor's **public line goes live on save** and admins can clear it (audited); **Quiet Pause is never shown** to the mentor; the composer's disabled send uses PressKey's house 0.55 opacity (the spec said 40 %); favourites affect Browse ordering only; the availability note is seeded from the application answer as a readable label. Spec `docs/superpowers/specs/2026-09-06-chat-profiles-composer-design.md`. Session 33.

**Implemented without a founder question (Calm-register default, veto in PROGRESS → Open):** Conversation Options items are no longer numbered "1. … 6."; mentors.tsx busy/network notes moved to i18n keys.

---

## L. Founder rulings — 2026-09-19 (session 35: positioning, message allowance, email, trust wording)

Source: the developer relayed these after the recovered 2026-09-06 walkthrough call and the Wispr-notes requirements review (kept outside the repo at the partner's request). They answer that review's open questions 1, 3, 4 and 5; question 2 (instant vs reply-when-free) was ruled the same day — see item 5.

**1. Positioning: a guidance app with communities inside it — not UPSC-only.** Mento serves people through **communities**; UPSC is the **first community inside the app**, not the product, and the app also accommodates people outside it with professional-register guidance. This *keeps* the communities-as-lens model (§J) and **rejects** the "UPSC guidance only" reading of the 09-06 call. What does change is the register: mentorship and guidance lead the copy; "emotional" and "anonymous" leave member-facing wording (session 35 copy pass), while the product stays persona-only and private (T&S #7 unchanged). The "Positioning decision" paragraph at the top of this file should be read through this ruling: *anonymous, low-friction support from a real mentor* still holds; "emotional-support app" is no longer the headline word.

**2. Member message allowance.** At most **3 messages in a row** before the mentor replies, and **10 messages per day** per member. A message (or conversation) flagged by the crisis scan is **never blocked and never counted** — the cap sits *after* the scan in the before-send hook, fail-open as today (T&S #1). The admin dashboard must show **counts** for this — messages sent, caps reached, crisis-exempt sends — as numbers only, never message bodies (T&S #10). Not built yet; test-required (crisis-scan list).

**3. Email stays optional and skippable** until an email service exists. No verification gate for returning members for now (§H.3 stands).

**4. Trust wording must read professional.** "Vetted by the Mento team" is retired (it reads as veterinary); the mentor profile now says "Reviewed and approved by the Mento team" — true for every mentor, since each one is approved through the admin applications queue. No badges, ticks or "verified" marks (v1 scope 2 stands).

**5. Connection promise: both paths, stated honestly.** If a mentor is online the member is connected right away (General match, unchanged); if nobody is free, the member chooses a mentor and that mentor replies when they have time (Personal request, unchanged; §K.12 "never a dead end" already routes there). Nothing in the matcher changes — only the promise does: "in under a minute" is retired from member copy, because with ~15 mentors it cannot be kept at all hours. The 09-06 "mentors answer when they have time" model is what members meet whenever no one is online. CLAUDE.md's "talking to a real human in under 30 seconds" stays as the *best-case performance target*, not a marketing promise.

**6. Rotating mentor names + consented "stay in touch" (revised the same day; supersedes the first wording of this item).** Mentor persona names **do rotate** (the 09-06 intent: browsing always feels fresh, and nobody fixates on or re-targets one name). Continuity is by **mutual consent**, not by a stable name: a member may **ask a mentor to stay in touch**; the mentor can accept or decline. If accepted, the link survives every name change — the member can always reach that mentor again, shown under whatever name they currently carry plus a stable "your mentor" marker (companion + when they first talked). Declining is quiet and carries no penalty for either side; either side can end it later. This **replaces the one-sided favourite** from §K.13 ("Ask for %{name} next time" becomes the stay-in-touch ask). Rules that follow: no count of "how many people stay in touch with me" is ever shown (never a reputation score, T&S #5); the ask is one tap and never nags; a mentor at capacity can still accept the link without opening a seat. Rotation cadence (sir said 24 h) and whether an in-progress conversation keeps its name until it ends are implementation details to settle in the spec. **Source: the developer's reconciliation of the partner's 09-06 idea with shipped favourites — confirm with the partner.** Not built.

**7. Stay in touch is capped at 2 mentors per member (for now); "In touch" is its own view.** A member can stay in touch with at most **two** mentors at a time; to add a third they end one first. My Chats gets a separate **All chats | In touch** switch — the In touch view lists only mentors who accepted. Writing to an in-touch mentor is allowed while another question is open (the one-open-question rule governs *new* asks to strangers), and still counts against the 3-in-a-row / 10-a-day allowance. The member-facing reason for the cap is the true one: it keeps conversations unhurried and protects mentors' time (T&S #5 — no dependency engineering). A mentor's name is never re-issued to another mentor while any member still holds it as a "first talked as" reference.
**Flag, not a ruling:** the founder intends a future paid version that lifts this cap. That is a paid membership tier, which DECISIONS §H.1 and T&S #4 currently rule out ("not membership tiers", "never gated"). Nothing in v1 copy may hint at it; it needs its own founder decision, a pricing/honest-money review and a privacy-policy pass before any design work.

**8. Design picks (2026-09-19, direction A board).** Request sent = "a letter on its way"; Chat = "alive" + the "In this chat" strip (topic · saved count · in-touch state) inside a composed header card; My Chats = richer rows + the In touch view; Path = the stage-centred home with the first-question builder and the "life rather than exams" finder; Journal = "today first, then the shelf" — one unified journal where anything saved from a chat lands beside the member's own notes. Direction A ("Pillow") is the working direction by use; B and C are parked, not rejected. These are board decisions — none is built in the app yet.

**9. Snooze 24 h on Mentor Home — founder, 2026-09-19 ("let's complete it").** Board A10's quiet **Snooze 24 h** key on a conversation that is waiting on the mentor is built end to end. It is the mentor's honest "I can't reply today" for one chat: for 24 hours the chat sorts below the awake ones and reads "Snoozed · back at <time>", the mentor gets no message pushes for it, and the capacity sweep does not end it. It **never hides a crisis**: a crisis-flagged member message ends the snooze at once (after the scan, in the Stream hooks), so the mentor is pushed and the chat returns to the top. The member is never told "snoozed"; they read the kind half of the promise — "<mentor> will reply within a day". Built (pending veto on the details under L.9 below).

**10. Mentor availability — founder delegated ("you sort it out"), 2026-09-19.** Board A37 draws multi-select time-of-day chips **Mornings · Evenings · Weekends** with a quiet "A few hours a week" caption. Decision: **keep both fields.** The single-choice commitment (`availability`: a few hours a week / most evenings / weekends / it varies) stays in the contract and is the quiet caption (tap to change); the chips are an additive `available_times` (the API also accepts afternoons and late nights for later), optional in the API so older builds still submit, at least one required by the current app. Approval turns the chips into the mentor's member-facing availability note ("usually here mornings and weekends"); the admin queue shows both. Nothing identifying is derived from it. **The paid-mentoring opt-in stays removed** from every member and mentor surface (founder: yes; where it lives later is his call) — `mentor_interest` is always false from the app. Built.

**11. Start fresh really erases — founder, 2026-09-19 ("build it"; launch blocker, audit F24).** `DELETE /api/v1/me` erases the member and everything keyed to them on our servers and on Stream, and only then does the app clear the device; the Start fresh sheet now says the board's A32 words ("deleted from this device and from our servers") because they are true. What is deleted, what is kept detached and why is written in `services/api/app/services/erasure.py` and `docs/PRIVACY.md` §5. Built (pending veto on the details under L.11 below).

**12. One mentor path, a loop until access is granted — founder, 2026-09-19 ("sort all the navigations and make it a unified experience").** Every door into the mentor side — Profile's mentor row, the role fork's "I want to mentor", the public `/apply` page, Mentor Home itself, old links to `/listener-apply` — runs ONE state machine (`apps/mobile/lib/mentorPath.ts`, rendered by `components/mentorPath/MentorPathFlow.tsx`) driven by the server's application status: **not applied** → the story (A38) → [the age gate, only for a visitor with no session] → the primer (A33) → the application (A37) → In review; **in review** → In review ("already applied"); **declined** → the calm note + when they may apply again (server `reapply_after`, the 30-day cooldown) → the application once allowed; **approved** → Mentor Home, no form, no primer. Profile's row says where things stand: "Become a mentor" / "Mentor application · in review" / the declined note with the date / "Open the mentor side" with a "Mentor access" chip. "I'd rather talk today" (and the loop's own way back when nothing is behind it) **continues the member sign-up with only what the account is missing** (founder, same day, item D): `GET /me` gains computed `has_dob` + `member_setup_complete`; no companion → the companion pick → Ready → My Chats on the same session; nothing missing → straight to My Chats. Built (pending veto on the details under L.12 below).

**13. Paid mentoring — a placeholder at mentor sign-up, founder 2026-09-19 ("like a placeholder — we are yet to confirm that. Coming soon.").** One still, non-interactive card inside the application form (A37), after the pledge: "Paid mentoring sessions · Coming soon — We have not confirmed this yet. Nothing changes for you today." No checkbox, no price, no promise; `mentor_interest` stays false. It lives only in the mentor sign-up form (never on a member screen), so nothing tells a member they will pay for support (T&S #4). **Open:** the public story (A38) still says "Voluntary and unpaid — nobody is paid to mentor here", which is true today; the two read side by side on the way through the loop — the founder may want the story line softened once paid mentoring is confirmed.

### L — pending founder veto (implementation choices made where §L is silent)

Built on 2026-09-19 (`feat/board-port`, API only). Each is a default the code already follows; strike or amend any of them. Client wiring: `docs/superpowers/specs/2026-09-19-board-port-api.md`.

**L.2 message allowance**
- **a. "10 per day" is per member across all their conversations; "3 in a row" is per conversation.** Any mentor message in that conversation resets the run.
- **b. The day is the IST calendar day** (00:00 Asia/Kolkata, fixed UTC+05:30). A member abroad resets at India's midnight.
- **c. "(or conversation)" is read kindly: for 24 hours after the scan flags anything in a conversation, that whole conversation is exempt** — follow-ups to something frightening are not rationed. They are tallied as crisis-exempt sends. (A member could lift their own limit by typing a crisis phrase; that also puts them in the human-review queue, which is the right outcome.)
- **d. Both limits reached → the note names the daily one** (the longer wait is the honest one).
- **e. A held message is not counted, and the server never echoes the member's text back.**
- **f. Holding ships switched OFF (`ALLOWANCE_ENFORCED=false`); counting is on.** The shipped app has no A22 note yet — an old build would show Stream's raw error bubble. Flip it when the client lands. Limits are env values (A13: "values live in server config").
- **g. Fail-open has a time budget (800 ms):** a slow database delivers the message uncounted, so the hook always answers Stream in time to keep the helpline card and the redaction.
- **h. The ledger keeps one row per member per day (counts only — no text, no message or conversation ids) for 35 days.**
- **i. Admin numbers are audited reads** (`allowance.viewed`), like the safety conversation view.

**L.6 rotating names**
- **j. Names change at 04:00 IST, not midnight** — midnight is peak chat time for aspirants; 04:00 is the quietest hour for a header to change. (The allowance still resets at 00:00 IST.)
- **k. An active chat follows the mentor's new name and says "first talked as <old name>"; an ended or wiped chat with a mentor the member is NOT in touch with keeps the name it ended under.** Otherwise My Chats would hand every member tomorrow's name for every mentor they ever met, and the consented link would mean nothing.
- **l. The mentor's avatar does not rotate** ("same owl, new name", A14) — so, with the public line, a mentor stays recognisable in Browse to someone who remembers them. Rotation is a presentation rule, not unlinkability: the listener id is stable in Browse and in Stream. Rotating the avatar too, or per-conversation Stream aliases, would be the stronger version.
- **m. Rotation is lazy (first read after 04:00), one mentor per transaction, never waits on the matcher; a new mentor keeps their first name until the next 04:00.** A newly issued name is never one a mentor carries now or one a pending / accepted link holds as "first met as" (§L.7); names from the last 30 days are avoided while the 576-name space allows.
- **n. The Stream user's display name is renamed with the mentor** (best-effort, retried) so header and bubbles agree.

**L.6–7 stay in touch**
- **o. A waiting ask holds one of the two places.** So a mentor's "yes" can never be refused for room the member gave away meanwhile. With one mentor in touch and one ask waiting, a further ask is refused (`in_touch_waiting`) until the ask is answered or taken back.
- **p. After "not now" the same member cannot ask that mentor again for 7 days** ("never nags"). The member sees a quiet `not_now` state; no reason is stored anywhere. Taking an ask back, or either side ending a link, carries no pause.
- **q. No push notification for an ask** (A14: "will see it next time they are here").
- **r. The mentor has no list and no count of who stays in touch with them** — only waiting asks, and an `in_touch` flag on each of their own conversations (where "end it" lives).
- **s. A report from EITHER side ends the link, as does a block or an admin suspension.** A mentor report does not end the chat (unchanged), but it does end the link.
- **t. Writing to an in-touch mentor uses what exists:** the still-active conversation, or a Personal request to that mentor. No new "open a chat without the mentor's accept" path was added; the one-open-question rule is not built server-side.
- **u. Favourites are deprecated, not removed, and are not converted into links** (a link needs the mentor's yes). Browse order: in touch → favourites → available → rank.

**Feedback (board A11; recovered-call item 13)**
- **v. A feedback row has no author** — role (member / mentor), category, words, screen route and app version only, because A11 promises "Nothing else". The author's id is used once, as a rate-limit key in Redis that expires within the hour (5 notes an hour). Cost: the team cannot reply to a note or bar one person from the box; contact details typed into it are redacted like chat.
- **w. No screenshot yet.** A11 draws one; the API has no file storage, and a screenshot of a chat would attach what the sheet says is never attached. If it is wanted: refuse it on chat screens, or blur message bodies on the device first.
- **x. Crisis words typed into the feedback box get the helplines back, are NOT kept as feedback, and raise a signal-only safety flag** (which does carry the member's id, like every other safety flag — it is a safety record, not feedback). The helplines answer is never rate-limited.
- **y. Reading the feedback list is an audited admin read** (`feedback.viewed`).

**L.9 snooze (item 9)**
- **z. "Waiting on you" means the member wrote, the mentor has read it, and has not replied.** An unread message keeps the "N new" pill instead (board A10's other row), so the key appears only once the mentor has actually seen what is waiting. Computed on the device from the Stream channel; the age reads "N min / N h / N d".
- **aa. Snoozing again never extends the window** (no rolling postponement); Undo is always available; the mentor's own reply ends the snooze (nothing is waiting on them any more); a member's ordinary message does not (the point is "I can't reply today").
- **bb. While snoozed, the stale sweep leaves the chat alone only until the window closes** — a 23-hour-old chat snoozed now is swept at the next pass after the snooze ends (the 24 h age rule, audit F8, is unchanged).
- **cc. The member's kind line lives in two places:** the My Chats row's second line ("<mentor> will reply within a day", above "first talked as") and the chat header's status ("Replies within a day", in place of here / away). Nowhere else; never the word "snoozed".
- **dd. 30 snooze changes an hour per mentor**, fail-open like every other limit.

**L.10 availability (item 10)**
- **ee. The commitment caption steps through its four values on tap** (a small select without a new sheet), defaulting to "A few hours a week" as the board draws it.
- **ff. The approval note uses the chips when present, else the commitment** ("a few hours a week"); the mentor can edit it afterwards from "Your line".

**L.11 erasure (item 11)**
- **gg. Conversation rows are deleted, not anonymised.** Every channel is hard-deleted on Stream first (the Clean Wipe path), so a kept row would describe a chat nobody can open; the mentor console already hides chats whose member no longer exists. The audit's P3 sketch said "anonymise"; deleting is the smaller, more honest footprint.
- **hh. Kept, detached:** safety flags (`user_id` → NULL; `conversation_id` kept as an opaque grouping key that resolves to nothing); a member's reports about a mentor (`reporter_id` → NULL — they protect other members); a mentor's reports about the member (`subject_id` → NULL); admin audit rows. One new audit row (`member.erased`, actor "Member erasure", counts only, no id or persona). Migration `9c5ada714a88` makes the two columns nullable. Reflections are DELETED, not kept: the model is pseudonymous (one join from the member), not anonymous.
- **ii. Dual role: refused, nothing touched.** While the member is also a live mentor (an approved application whose mentor profile is still approved), erasure answers 409 `mentor_active` and the sheet explains it calmly: erasing the member would cut the mentor's only in-app way back to the console and strand the members they are talking with. A suspended mentor side does not block erasure (the suspended profile stays, with its own identity). **Open:** there is no self-serve "step back from mentoring" yet — today the team does it (admin suspend); the sheet tells the mentor to ask the team.
- **jj. Fail-safe order:** end chats / links / requests (committed — seats free at once) → Stream channels (each marked wiped as it goes) → the Stream user → delete + detach in one transaction. Any Stream failure answers 503 `erase_incomplete`: chats are ended, nothing else is claimed, the device keeps its session so "Try again" works. A channel or Stream user that is already gone counts as done.
- **kk. Idempotent:** a session whose member is already erased gets 200 again and nothing happens. Limit: 10 tries an hour per member, fail-open.
- **ll. No contributions exist yet (Razorpay not wired); erasure deletes the member's rows.** When payments land, a paid contribution's receipt may have to be kept for tax law — decide then (detach, don't delete).

**L.12 the mentor path (item 12, incl. founder item D)**
- **mm. The role fork's mentor branch is now fork → age → email → hand-off (A34) → the loop's story.** The primer moved out of the journey into the loop (so everyone meets it in the same place); A34's "Go to Mentor Home" became "Continue" and its line now says what comes next ("what mentoring here asks of you, then a short application"), because Mentor Home opens only once approved.
- **nn. Mentor Home is the approved mentor's screen only.** Anyone else who reaches it (a returning not-yet-approved mentor from the landing, a notification, an old link) is handed to the loop (`replace` — Mentor Home must not stay behind it). A loop that opens on an already-approved account forwards to Mentor Home (`dismissTo`); an approval that arrives while "In review" is on screen shows A37's "Approved" card with "Open Mentor Home" instead.
- **oo. The member skips the age gate everywhere in the loop** (they passed it at sign-up); a visitor on `/apply` with no session meets it after the story, as before. A visitor who returns to `/apply` in the same browser lands where their application stands (no second anonymous account).
- **pp. The public page carries no animal art anywhere in the loop** — the primer's companion perch and the status card's companion are hidden on `/apply` (founder rule: the human scene on public pages).
- **qq. "I'd rather talk today" ends on My Chats, not in a live match.** A mentor switching sides came to look around; a chat is one tap away there. Age and email are never re-asked (every session was minted by the server's 18+ gate — `/apply` included — so `has_dob` is always true today); email stays optional. Back from the companion pick = "never mind": still on the mentor side.
- **rr. The loop's way back** reads "Back to Profile" when Profile is behind it, otherwise "I'd rather talk today" (a new mentor from the fork has no member side yet).
- **ss. The declined line names the date** ("You can apply again from 19 October") from the server's cooldown anchor; inside the month there is no form at all, after it an "Apply again" key goes straight to the application (they have seen the story and the primer).
