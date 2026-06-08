# Mento — Product Requirements Document

**Version:** 2.0 (synthesis + hardening)
**Owner:** Arieddin Sheik
**Status:** Pre-MVP build spec
**Audience:** Engineering, founding mentor cohort, CA/legal

---

## 0. One-line

Mento is an anonymous, low-friction emotional-support and mentoring app: a person in a hard moment can open it and be talking to a real human in under 30 seconds, with no login, no name, and no judgment — and, if they want, go deeper with a specialist mentor in a vertical they care about (starting with UPSC).

---

## 1. Why this exists

The wedge is a specific, underserved person: someone who is emotionally drained but socially constrained — they can't or won't open up inside their own circle, often *because* of status, reputation, or the fear of being seen as struggling. They have money and standing; what they lack is a safe, frictionless place to be heard by someone with no stake in their life.

Mento removes every barrier to that first conversation, and then earns the right to a relationship by being genuinely useful — not by manufacturing dependency.

**Design principle that governs everything below:** we win when a user *leaves better off*, returns *because it worked*, and pays *because they chose to*. Any mechanic that depends on the user not understanding what's happening is out — both because it's wrong and because it's the single fastest way to get pulled from the stores and sued.

---

## 2. Product shape: one app, two modules

| | **Module A — Anonymous Chat** | **Module B — Specialization Mentoring** |
|---|---|---|
| **Purpose** | Emotional / peer-to-peer support. "What do I do, I just need to talk." | Structured mentoring in a vertical (UPSC first; later NEET, fitness, yoga, etc.) |
| **Identity** | Anonymous, auto-assigned persona | Mentor has a real profile; mentee can stay anonymous |
| **Who responds** | Trained/vetted listeners + (initially) you | Domain mentors |
| **Money** | Optional contributions ("coffee"), transparent | Mentor-set session fees; platform takes a cut |
| **Build order** | **First** | Second |

Journals already exist and carry into this app. Moderation is its own module, built third.

---

## 3. ICP and the emotional arc (the honest version)

**Ideal user:** emotionally drained, socially isolated-by-status, financially comfortable. Day-one mood stack to design around: *confusion → fear → uncertainty → anxiety → low self-esteem.*

**The arc we want — and the line we won't cross:**

- A first conversation where the user feels *heard* without expectation is genuinely powerful. We design for that: listen first, don't pitch, don't extract.
- Users will naturally return when something helped. **Good.** We support that return.
- We do **not** engineer attachment as the product. We measure "did this conversation leave them with something usable" (a reframe, a next step, a saved journal note), not "how many hours of dependency did we create."
- If a user shows signs of genuine crisis, the product's job is to *help them toward real support*, not to retain them. See §10.

> Reframe, in your own words: the dependency you observed in your research is real, but it's a *symptom of the value*, not the lever to pull. Pull the value lever. The attachment follows, and it's the kind that survives a user reading our privacy policy.

---

## 4. MVP scope — "for us, not the market"

A test build for 10–20 paid users to validate the chat experience. Explicitly **not** the polished v1.

**In scope**
- Onboarding flow (§5)
- Working real-time chat: text + basic emoji, instant delivery, zero technical friction
- New-chat ("+") flow with general + personal request routing
- Mentor/listener profiles, searchable by issue / gender / availability
- Journals (carried over) with two seeded channels
- Transparent contribution surface ("coffee"), built but understated

**Out of scope (deliberately deferred)**
- Color system / branding (MVP is grey + white)
- Full philosophy layer (notification tone, warnings, content voice)
- Notification-based expense capture (§9, post-MVP)
- Self-serve mentor portal (manual provisioning for now)
- Group sessions

**Visual:** grey-and-white only. The single intentional accent is the contribution affordance (§8) — kept subtle, never animated into the chat.

---

## 5. Onboarding flow

Friction is the enemy. The day-one user is anxious; every field is a reason to bounce.

```
Landing  →  "Start Chat"
        →  Affirmation: "This is a safe place."
        →  Age
        →  Date of birth
        →  Gmail  (OPTIONAL — not mandatory, clearly skippable)
        →  Connecting…  →  Chat frame (already talking to a listener)
```

- No username, no password, no phone number, no name required.
- "Connecting…" resolves *into* the chat — the dashboard is effectively the conversation. The user's first screen after onboarding is a live chat frame, not a menu.
- Age/DOB are collected for one reason and stated plainly: routing and a minimum-age gate (see legal, §13). This is *not* a tracking play.

---

## 6. Module A — Anonymous Chat (build first)

### 6.1 Identity
- Each user gets an auto-assigned persona: a friendly random name + avatar, composed from neutral element pairs (nature, animals, etc.) — e.g. "Listening Panda."
- Same generator for both sides of the conversation.
- Avatar/name persist per session so the relationship feels continuous.

### 6.2 Chat window (MVP)
- Text + basic emoji only.
- Instant send/receive, typing indicator, read state.
- Feel: clean and conversational, in the spirit of a modern AI chat UI (Claude/ChatGPT-like spareness) — *not* a busy messenger.
- A user can long-press / right-click any message from a listener and **"Save to journal"** (pick a journal). This is the bridge from talk → action.

### 6.3 Starting a new conversation
The "+" button (bottom) starts a new chat. Two paths:

| | **General request** | **Personal request** |
|---|---|---|
| User provides | Just the issue category | Picks a specific mentor |
| Discovery | — | Browses mentor profiles, filters by **issue · gender · online/availability** |
| Routing | Broadcast to available listeners in that category | Lands in that mentor's **inbox** |
| Accept | First available listener accepts | That mentor accepts/declines |

- **Issue categories:** 5–10, placeholder names for now (studying, family, relationships, self-esteem, loneliness, focus/distraction, …). Final names TBD.
- Mentors select the 4–5 categories they're comfortable with at onboarding; routing respects this.
- Inbox pattern mirrors the existing UPSC app — reuse it.

### 6.4 First-conversation playbook (operational, not code)
For the first cohort, **you** are the primary listener. The pattern to systematize and later train others on: listen first, reflect, don't pitch, surface one or two usable takeaways the user can save. The product supports this by making "save this point" one tap.

---

## 7. Module B — Specialization Mentoring (build second)

- Verticals as modules; **UPSC only at launch.** NEET, fitness, yoga, etc. are roadmap.
- Mentors run their own sessions (1:1 or group), set their own price and schedule. It is the mentor's job to build the relationship with a mentee and convert them to longer-term mentoring.
- Mentor profiles are the discovery surface (shared with §6.3 personal-request flow).
- Platform takes a percentage of paid sessions (§8.3).

This module reuses the profile, search, inbox, and chat infrastructure from Module A — build A well and B is largely composition.

---

## 8. Monetization — the "coffee" model, done transparently

### 8.1 Principle
Contribution is opt-in, never gated, never required. Mento is free to use. The ask is framed as supporting the people and team behind it — and it is *labeled as what it is.*

### 8.2 What changes from the original sketch — and why
You described hiding the payment so the conscious mind never registers it ("the trap"), surfacing it only once the user is emotionally high, and never calling it a membership. **I've kept the warmth and removed the deception**, because the trap version fails three tests that matter to you:

- **Store policy:** Apple and Google both reject apps that obscure billing or manipulate vulnerable users into payment. This is a known rejection/removal category.
- **Legal:** taking money from people in an altered emotional state via an intentionally-obscured mechanism is the fact pattern for an unfair-practices / consumer-protection complaint, and a brutal one in discovery.
- **Reputation:** the moment one user posts "this 'free' mental-health app tricked me while I was at my lowest," the brand is done.

The good news: you don't need the trap. A *transparent* tip model aimed at people who already felt real value converts fine — better, even, because it survives scrutiny.

### 8.3 How it actually works
- A clear, calm **"Support Mento"** affordance, available from the menu from day one (not hidden, not delayed, not animated into the chat).
- Tapping it opens a menu of contribution sizes: a coffee for the team, dinner, "back us for a month," up to a high open ceiling (₹49 → ₹1 lakh+, no cap).
- Never pops up *inside* a conversation. The reasoning you had is right — interrupting a vulnerable moment with a paywall is both gross and counterproductive. The difference is we keep it *discoverable and honest*, not *hidden until they're primed*.
- Copy is plain: this supports the team; it is not a fee for the listener.
- **Session payments (Module B)** are separate and explicit: mentor sets a price (~₹200–250 typical for peer 1:1), platform takes ~10%.

### 8.4 The ethical gap you flagged — resolved
You correctly spotted: a mentee who "buys a coffee" may believe it pays their listener; it doesn't. Fix it at the source so no one is ever misled:
- Coffee/contribution copy explicitly says it supports the *platform and team*, not the individual listener.
- Listeners are recognized through a **non-cash reputation system** (§9), which is disclosed.
- Paid 1:1 sessions are the *legitimate, transparent* way a mentor earns — clearly priced, clearly a session.

---

## 9. Listener reputation & 1:1 conversion

- Contributions and positive outcomes raise a listener's **reputation rank** (non-cash).
- Higher rank → higher priority in matching for relevant requests in their domain.
- When rapport exists, a listener can offer a **paid 1:1 session** (their price; platform ~10%). This is the clean earning path, fully disclosed.
- Guardrail: a listener must never condition emotional support on payment, and never reference contributions to pressure a user. This is a moderation-enforced rule (§11), not a nudge.

---

## 10. Safety & crisis architecture  *(new — non-negotiable)*

This is the section that turns Mento from a liability into something you can defend in front of a regulator, a journalist, or a grieving family. It is also, bluntly, what gets you *approved* by the app stores for the mental-health-adjacent category.

- **Crisis detection:** lightweight signal scan on incoming messages for self-harm / suicidal / abuse indicators. On trigger:
  - Surface India-appropriate helpline resources immediately (e.g. Tele-MANAS / KIRAN — verify current numbers at build time).
  - Switch the conversation tone to support-and-refer, not retain.
  - Flag for a trained human reviewer.
- **Listeners are not therapists.** Onboarding makes this explicit; UI states it; listeners are trained to refer, not treat.
- **No diagnosis, no clinical claims** anywhere in copy.
- **Age gate:** the DOB collected at onboarding enforces a minimum age; under-18 flows are restricted or blocked (decide with CA — minors + mental health + payments is a high-risk combination you likely want to exclude entirely at MVP).
- **A user in genuine crisis is helped *out*, not retained.** Retention metrics explicitly exclude crisis sessions.

> This isn't compliance theatre. An anonymous app where distressed people talk to untrained strangers, with payments attached, *will* eventually have a user in real danger. Deciding now what happens in that moment is the most important product decision in this doc.

---

## 11. Moderation (Module C — build third)

Risks: anonymity abuse, repeat users probing limits, opposite-gender harassment, listeners drifting toward voyeurism of users' disclosures.

**Layered enforcement:**
1. **App/UI design** — structural friction against abuse (rate limits, no media in MVP, etc.)
2. **Listener redirect** — listener verbally sets the boundary.
3. **Warning pop-up** — system warning to the user.
4. **Temporary suspension** — cool-down on the account.

**Stance:** abusive/extractive users are not worth retaining. Quality of the room > raw user count.

**Listener vetting:** the "onboard psychology students via a college seminar" plan is good *if* paired with basic listener training (boundaries, crisis referral, no-treatment rule) and a short screening. Untrained anonymous listeners + vulnerable users is the risk; lightweight training closes most of it.

---

## 12. Journals & the personal-life agent

- Carry over existing journal infrastructure — do not rebuild.
- Seed two channels: **Daily Journal** and **Expense Tracker.**
- Conversational logging via the agent: user types "spent ₹40 on lunch," agent logs it to that day's finance entry. Same for free-form evening journaling.
- "Save to journal" from chat (§6.2) feeds the same store.

---

## 13. Notifications & the habit loop  *(post-MVP)*

The insight is right: people won't self-log expenses without a trigger. Planned mechanic (not in MVP):
- With explicit user permission, read incoming bank credit/debit notifications on-device.
- On a transaction, prompt: **"Add this to your expense log?  [Yes] [No]"** — two taps, nothing else.
- Strictly opt-in, permission-gated, transparent about what's read and why. (Notification-access scraping is itself a store-review flashpoint — needs a clear privacy disclosure.)

---

## 14. Data model (starting point)

Core entities — refine in schema:
- `user` (anon_id, age, dob, gmail?, persona_name, persona_avatar, created_at)
- `listener_profile` (id, display, categories[], gender, availability, rank, vetting_status)
- `conversation` (id, type [anon|mentoring], participants, status, started_at)
- `message` (id, conversation_id, sender, body, created_at)
- `request` (id, kind [general|personal], issue_category, requester, target_listener?, status)
- `journal_entry` (id, user, channel [daily|finance|custom], body, source [manual|chat|notif], created_at)
- `contribution` (id, user, amount, type, created_at) — *audited, plain-labeled*
- `session` (id, mentor, mentee, price, platform_fee, scheduled_at, status)
- `moderation_event` (id, user, level [1-4], reason, created_at)
- `safety_flag` (id, conversation_id, signal, reviewed_by, action)

**Minimize PII by design:** anonymity is a feature *and* a compliance asset — don't quietly collect what you've promised not to. The privacy policy and the actual data flows must match exactly (this is the "say you won't sell data then sell it differently → get sued" failure mode you already named).

---

## 15. Tech stack

Aligns with your existing build: **FastAPI + PostgreSQL** backend, **React** web, **Expo / React Native** mobile. Real-time chat via WebSockets (or a managed layer if it ships faster for MVP). Reuse the existing journal + inbox modules from the UPSC app.

---

## 16. Go-to-market & PR

- **Seed supply:** you as primary listener; onboard 5–10 vetted mentors via the psychology-college seminar (positioned honestly as a beta).
- **Seed demand:** 5–15 **paid** test users at ₹49 — never free, because free testers give worthless feedback. Goal is qualified feedback, not vanity installs.
- **PR / momentum:** the cross-app "acquisition announcement" idea can create curiosity — but only announce things that are *true* (a real feature merge, a real integration). Fabricated acquisitions are a credibility landmine and, if material, a legal one. Real-but-amplified > invented.
- **Influencers:** paid Instagram seeding is fine; disclose paid partnerships (ASCI rules in India).

---

## 17. Legal & compliance (CA workstream, ~3 months)

- Company registration.
- **Privacy policy that matches reality** — data collected, retention, no-sale commitment, on-device notification access disclosure.
- Terms of service incl. "not a medical/therapy service" disclaimer.
- Payment/contribution terms (clear that contributions support the platform).
- NDAs for collaborators/investors; advisor equity (~5% noted).
- Minor-protection decision (recommend excluding under-18 at MVP).
- Mental-health-adjacent positioning review — avoid any clinical claim.

---

## 18. Timeline

- **Target:** ~1 month to MVP (May 24 ruled out).
- **Build order:** Chat module → Mentor onboarding module → Moderation module.
- **Cohort:** 5–10 mentors, 5–15 paid users, grey/white build, feedback-only objective.

---

## 19. Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Vulnerable user in genuine crisis, no safeguard | **Critical** | §10 crisis architecture, built into MVP |
| Obscured-payment dark pattern → store removal / suit | High | §8 transparent model |
| Untrained listeners cause harm | High | §11 vetting + basic training |
| Privacy policy ≠ actual data flows → litigation | High | §14 minimize PII, policy-reality match |
| App-clone IP exposure (separate portfolio strategy) | Medium | Compete on function, not copied UI/assets/brand; CA review |
| Fabricated "acquisition" PR backfires | Medium | Announce only true events |
| Anonymity abuse / harassment | Medium | §11 layered moderation |
| Retention proves hard | Medium | Win on real value + saved-takeaways loop, not dependency |

---

## 20. Open decisions

1. Final issue-category names.
2. Under-18: block entirely at MVP? (recommend yes)
3. Crisis-helpline list — confirm current India resources at build.
4. WebSocket vs managed real-time layer for fastest MVP.
5. Listener training scope — minimum viable curriculum.
6. Contribution ceiling display — show the high tiers, or only on expand?

---

*This PRD keeps your core thesis intact — frictionless, anonymous, human, free-with-optional-support — while replacing the two mechanics that would have made it indefensible (hidden payment, engineered dependency) with versions that still convert and won't end the company. The retention engine is real value plus a save-it-and-act loop; the money is honest; the vulnerable user is protected. That's the version you can scale, raise on, and defend.*
