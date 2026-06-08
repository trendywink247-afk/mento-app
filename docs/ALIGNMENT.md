# Mento — Alignment Table (PRD × Mockups × Build-now)

**Date:** 2026-06-08 · Sources: `PRD.md` (v2.0), `DECISIONS.md` (authoritative, Option A), `MOCKUP_INVENTORY.md` (64 screens). Where DECISIONS has ruled, that ruling is the answer.

Legend — **Build now?**: ✅ v1 · 🟡 v1 but simplified/needs work · 🔜 deferred (v2+) · ⛔ out / forbidden.

---

## 1. PRD features → mockup coverage → build decision

| # | PRD feature | In PRD | In mockups | Build now? | Notes / gaps / contradictions |
|---|---|---|---|---|---|
| 1 | Low-friction onboarding (landing → start → affirmation → age/DOB → optional Gmail → connecting → chat) | §5 | ✅ #1,#2,#3,#4,#5,#63 | ✅ | Mockups add a **growth-companion (animal+colour)** step not in PRD — keep (DECISIONS D). |
| 2 | Age + DOB collection, age-gate | §5,§10 | ✅ #3 | 🟡 | **Contradiction:** picker reads "18 Years / 05 Months / 2002 Year" — incoherent. Build a real **D/M/Y** DOB picker; compute age server-side (DECISIONS E.15). |
| 3 | Optional, skippable email (no phone/password/name) | §5 | ✅ #4 | ✅ | Consistent. **Brief said MSG91 phone OTP → dropped from user path** (DECISIONS A.2). |
| 4 | Anonymous auto-persona, both sides, persistent | §6.1 | ✅ (mixed) | 🟡 | **Contradiction:** mockups mix personas ("Purple Valley") with **real names+photos** ("Aisha · Verified Mentor", "Nirav"). v1 = personas only; real profiles → Module B (DECISIONS B). PRD example "Listening Panda" retired; use "[Evocative] [Nature]". |
| 5 | Real-time chat: text+emoji, instant, typing, read state | §6.2 | ✅ #6,#7,#8,#20 | ✅ | Spare Claude/ChatGPT-like feel. Realtime layer (Stream vs WS) still open (G). |
| 6 | "Save to journal" from a chat message | §6.2 | 🟡 destination only | ✅ | Destination "Mentor Notes" drawn (#8); **the long-press gesture/action was not** — build it (DECISIONS E.13). Core talk→action loop. |
| 7 | New-chat "+" → General vs Personal routing | §6.3 | ✅ #56 (general), #50–#53,#56 (personal) | ✅ | Build both. **Broaden topic chips to life/emotional** (family, relationships, self-esteem, loneliness, focus), not UPSC-only (DECISIONS E.14). |
| 8 | Issue categories (5–10) | §6.3 | 🟡 UPSC-leaning chips | 🟡 | Mockups show UPSC chips (Prelims/Mains/Interview). Final names **open** (DECISIONS G); lean life/emotional. |
| 9 | Mentor/listener discovery + filters (issue·gender·availability) | §6.3,§7 | ✅ Mentors list, #50,#51 | ✅ | Filters present (availability/language/gender). "**We don't use star ratings**" — keep (good call). |
| 10 | Inbox pattern (reuse UPSC app) | §6.3 | ✅ #54,#55 | ✅ | My Chats list with All/Active/Completed/Archived + New Chat FAB. |
| 11 | Module B — specialization mentoring (paid sessions, mentor-set price, ~10% cut) | §7,§8.3 | ✅ profiles #50,#51 | 🔜 | Deferred. Real mentor profiles + session payments ship **with Module B** (DECISIONS positioning, B.5). |
| 12 | Contribution "coffee" — transparent, opt-in, from menu, never in-conversation | §8 | ✅ #9(item6),#24,#28 | 🟡 | **Conflicts to fix:** mockups trigger the coffee **right after a positive end-of-chat rating** and inside the conversation options — PRD forbids in-conversation/primed asks. Keep contribution **discoverable from menu**, decouple from the reflection moment. Cut "Panda earned a coffee" reward framing (DECISIONS A.3). |
| 13 | Session payments separate & explicit (Module B) | §8.3 | — | 🔜 | With Module B. |
| 14 | Listener reputation rank (non-cash) + paid 1:1 conversion | §9 | — | 🔜 | Not drawn. Defer with Module B. |
| 15 | **Crisis detection + India helplines + refer-not-retain + human flag** | §10 | ⛔ only a footer | ✅ | **Biggest gap.** 64 screens have only a "you're not alone" footer. **Build the real flow** (DECISIONS E.12). Non-negotiable. Verify Tele-MANAS/KIRAN numbers at build. |
| 16 | Listeners-are-not-therapists / no clinical claims | §10 | 🟡 implied | ✅ | State explicitly in onboarding + UI copy review. |
| 17 | Age gate / exclude under-18 | §10 | 🟡 #3 collects DOB | ✅ | Build the gate. **Under-18 block = open decision** (PRD recommends yes; G). |
| 18 | Moderation: layered enforcement + report/block | §11 | ✅ report/block #27; #20 | 🟡 | v1: report/block UI + moderation_event logging + rate limits. Full **moderation console = Module C (build third)**. |
| 19 | Listener vetting/training | §11 | — | 🔜 | Operational, not app code for v1. |
| 20 | Journals: Daily + Expense, conversational AI logging | §12 | ✅ #29,#30,#32 | ✅ | Mockups **expand 2→several**. Keep AI Journal Assistant (= PRD agent), **Finance**, **Mood/Daily**, **Mentor Notes**; Gratitude/Panda Wisdom optional (DECISIONS D.11). Don't rebuild — carry over. |
| 21 | Bank-notification expense capture | §13 | — | ⛔ | Post-MVP, permission-gated. Out of v1. |
| 22 | Data model entities | §14 | n/a | ✅ | Use as schema starting point; add: persona, companion(animal/colour), conversation lock/PIN, status-mask, reflection, contribution, safety_flag. |
| 23 | Tech stack | §15 | n/a | ✅ | See CLAUDE.md. Realtime layer open. |

---

## 2. In the mockups, not (really) in the PRD — scope calls

| Item | Screens | Build now? | Ruling |
|---|---|---|---|
| Conversation **PIN-lock + biometric** | #9,#10–#19 | 🟡 | v1-optional, **simplified** — don't stack numpad + email-reset + fingerprint + "panda protection" in one state. Behind the options menu (DECISIONS D.9). |
| **Status mask** ("Panda Mask") | #21,#22 | ✅ | Per-conversation visible status. Fine as drawn. |
| **Mute/pause** ("Panda Pause") | #25 | ✅ | = PRD mute, themed. Keep (DECISIONS D.10). |
| **End vs delete-both-sides** ("Panda Wipe") | #26 | 🟡 | ⚠️ Copy promises *"we don't store messages on our servers; they live only on your device."* **Conflicts with Stream Chat** server storage. Resolve before launch (CLAUDE T&S #8). |
| **Report / Block** with reasons | #27 | ✅ | 7 reasons incl. "asking for money", "sexual", "aggressive". File moderation_event. |
| **End-of-conversation reflection** (energy slider) | #23,#64 | ✅ | Keep. **No points.** Decouple from contribution (DECISIONS A.3). |
| **Growth companion** (animal + colour) | #58–#62 | ✅ | Onboarding personalization/theme. **Never the chat handle** (DECISIONS B.6). Both purple + grey theme variants exist in mockups — v1 = light indigo. |
| **UPSC self-assessment suite** (The Mirror / Knowledge Assessment / Preparation Challenges / growth dashboard) | #34–#49 | 🔜 | **Defer** — own module later (DECISIONS D.8). Heavy footprint (16 screens) but out of v1. |
| **UPSC Journey** study tracker | #33 | 🔜 | UPSC-coaching, not emotional-support core. Defer. |
| **AI Journal Assistant** auto-routing | #29 | ✅ | = PRD §12 conversational logging agent. Confirmed. |
| **Panda Wisdom** journal | #31 | 🟡 | Optional v1 (save AI/mentor thoughts). |
| **Account creation** (email+password) post-chat | #57 | 🔜 | Keep **anonymous-first**; "save your journey" is optional, not a gate. |
| **Community** tab | referenced #49,#53 | 🔜 | Tab named in navs + "explore community conversations" — **no screen exists.** Defer; don't promote to primary nav. |

---

## 3. In the PRD, not in the mockups — build regardless

| Item | PRD | Status in mockups | Action |
|---|---|---|---|
| Crisis/helpline flow | §10 | Footer only | **Design + build** (see row 15). |
| Save-to-journal **gesture** | §6.2 | Destination only | **Build the long-press action.** |
| Listener reputation / paid conversion | §9 | Absent | Defer (Module B). |
| Bank-notification capture | §13 | Absent | Out of v1. |

---

## 4. Brief ↔ PRD/mockups contradictions (founder's brief vs. the docs)

| Brief said | Reality in PRD/mockups/DECISIONS | Resolution |
|---|---|---|
| **MSG91 OTP** in onboarding | PRD: no phone; mockups: email-only, skippable | **Drop from user path.** MSG91 only for mentor verification (deferred). |
| **Razorpay ₹399/599/999 tiers** | Mockups: coffee tips ₹49/99/199/499; PRD §8.2: *"never call it a membership"* | **Razorpay = processor, yes.** But money model is **transparent contribution + Module B session fees**, not 3 subscription tiers. ⚠️ **Open decision** — confirm intent. |
| Handle "**Purple Valley**" | PRD example "Listening Panda" | Mockups win; standardize "[Evocative] [Nature]" (DECISIONS B.6). |
| **Stream Chat** for messaging | PRD: "WebSockets *or* a managed layer"; realtime still listed open (G) | Recommend Stream for MVP speed, **but** resolve the no-server-storage / Panda-Wipe promise first (T&S #8). |
| **Pick animal + colour** "growth companion" | Not in PRD; in mockups | Keep as onboarding theme; never the chat handle. |
| **PIN-lock + fingerprint** on a conversation | Not in PRD; heavy in mockups | v1-optional, simplified. |
| Points reward on reflection | PRD anti-dependency (§3); mockups show **no points** (only "panda earns a coffee") | **No points.** Keep private reflection; cut the coffee-as-reward link. |
| Grey + white visual (PRD §4) | Mockups: light indigo/lavender (only 2 grey screens) | **Mockups win** — build light indigo v1 (DECISIONS A.1). PRD §4/§18 stale. |

---

## 5. Internal mockup inconsistencies to resolve in design

- **Bottom nav differs across screens:** `Chats·Journals·Mentors·Profile` (4) vs `Home·Mentors·Mirror·Chats·Profile` (5) vs `Home·Mentors·Mirror·Community·Profile`. → **Use the 4-tab chat-first nav** (DECISIONS C.7); don't promote Mirror/Community.
- **Self-assessment length disagrees:** "Step 1 of 8/9/10", "Step 6 of 7", scales 1–5 vs 0–100 vs word-labels. → Irrelevant for v1 (deferred); pick one when the assessment module is specced.
- **Avatars:** real photos (Aisha, inbox) vs nature images (Purple Valley). → personas/nature only in v1.
- **Duplicates:** #23≡#64; #12/#13/#14 near-identical PIN frames; #26/#27/#31 are multi-frame how-to composites, not single screens.

---

## 6. Decisions — resolved & still open

**Resolved by founder rulings 2026-06-08 (see `DECISIONS.md` §H):**
1. ✅ **Payments:** drop ₹399/599/999 tiers; Razorpay = processor only; v1 = transparent coffee/tip (₹49–499 + open ceiling), never gated/in-conversation. Module B fees later.
2. ✅ **Storage / "Panda Wipe":** keep Stream Chat; reword copy to honest deletion (device **and** servers); implement real server-side delete; never claim on-device-only.
3. ✅ **Auth/OTP:** no phone in user flow; optional email for recovery; MSG91 reserved for mentor verification (Module B).
4. ✅ **Realtime layer:** Stream Chat.

**Still open (founder / CA):**
5. Under-18: block entirely at MVP? (PRD recommends yes.)
6. Final issue-category names (life/emotional-leaning).
7. Crisis-helpline list: confirm current India numbers at build (Tele-MANAS / KIRAN).
8. Listener training: minimum viable curriculum.
