# Mento — PRD ↔ Mockups Reconciliation & Decisions

**Date:** 2026-06-08 · **Updated:** 2026-07-11 (§I — motion, mascot, listener console) · **Owner:** Arieddin Sheik · **Status:** Final (Option A)

**Authority:** This document resolves every conflict between `Mento_PRD_v2.md` and the 64 UI mockups. **Where this doc disagrees with either the PRD or the mockups, this doc wins.** Claude Code must read `PRD_v2` *and* this file at the alignment step and resolve nothing by guessing.

---

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

**5. The chosen animal is the star.** From the moment the user picks their growth companion, **their animal — not a fixed panda — carries the companion identity everywhere** (onboarding stage, ready celebration, matched moment, profile). The panda remains the *brand guide* only before the choice is made. This extends B.6: companion = personalization/theme, never the chat handle.

**6. Minimal listener console ships in v1.** A real human must be able to answer chats before Module B. Scope: **web-only console, per-listener token-link auth (no password), see own conversations, reply in real time, accept/decline own Personal requests, toggle online/away.** Explicitly NOT: mentor profiles, payments, MSG91 verification, profile editing, push — those remain Module B. Anonymity holds on both sides (listeners see member *personas* only), and the crisis card renders listener-side so the listener knows what helplines the member was shown. The global-admin-token accept/decline stays for moderation/ops.

**7. Sensory scope: visual + haptics, NO audio.** A designed haptic vocabulary (selection tick on choices, light impact on step advance, success on match — `apps/mobile/lib/haptics.ts`) and nothing audible: someone opening a support app in public must never fear sound. All motion respects reduce-motion (system setting on native, `prefers-reduced-motion` on web) — the flow must be fully usable with every animation stripped.