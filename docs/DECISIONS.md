# Mento — PRD ↔ Mockups Reconciliation & Decisions

**Date:** 2026-06-08 · **Owner:** Arieddin Sheik · **Status:** Final (Option A)

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
- Real-time layer: WebSocket vs managed (Stream Chat) for fastest MVP.
- Listener training: minimum viable curriculum.