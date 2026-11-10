# Mento Pilot Plan — DRAFT for founder review (2026-07-30)

> **Status: DRAFT.** Nothing here is decided. Every item marked **[FOUNDER]** needs an explicit ruling; defaults shown are recommendations, adjustable with one line.
> **What this reconciles:** the founder–developer call transcript (50 mentees / 15–20 mentors / caps / cooldowns / manual accounts) against what this repo has actually built and ruled (`DECISIONS.md` → `PRD.md`). Where the transcript and the repo conflict, this plan follows the repo and flags the conflict.
> **Companion doc:** the seven conflicts are logged in `PROGRESS.md` → session 23 → Open decisions.

---

## 1. The one-sentence purpose

**At the end of the pilot we decide: does the anonymous-listener product as built (Module A) earn a public launch as-is, need redesign, or need the deferred mentor module (Module B) pulled forward?**

Every metric, gate, and week below exists to answer that sentence. If a proposed pilot activity doesn't feed it, it's out.

## 2. What the pilot tests (and what it doesn't)

**Tests — the product as shipped (v1 is feature-complete per the 2026-07-21 audit):**
- Anonymous onboarding → match → live chat in under 30 seconds (the hero promise).
- General matching + Personal (pick-a-listener) requests.
- Conversation controls (Lock, Mask, Pause, End, Panda Wipe), save-to-journal, reflection.
- Path communities as a soft matcher preference (UPSC first cohort).
- The become-a-listener funnel (session 22) as the *real* listener onboarding path.
- Crisis flow end-to-end in the wild (the non-negotiable).
- Whether volunteer listeners stay willing at real load.

**Does NOT test (deliberately):**
- Paid sessions, verified-mentor profiles, session booking — **Module B, deferred by DECISIONS**. The `mentor_interest` flag in the listener application already stages Module B interest; the pilot *measures* that signal instead of building the module.
- Session caps / cooldowns / time-boxes — no "session" concept exists in the codebase; conversations are open-ended. See D3.
- Payments — Razorpay creds absent; the coffee screen ships transparently disabled, which is itself a fine pilot state.

## 3. Founder decisions required before Week 0 — [FOUNDER]

| # | Decision | Recommendation |
|---|---|---|
| D1 | **Pilot scope: Module A as built, or re-scope toward Module B?** | Module A. If the real intent is verified paid mentorship, that is a DECISIONS-level product change to make *before* piloting, not a pilot config. |
| D2 | **Accounts: real anonymous onboarding, or manual username/password + ticks (transcript)?** | Real onboarding. Manual credentialed accounts violate DECISIONS §C and mean the pilot never exercises the thing v1 exists to prove. Members onboard themselves in front of you at recruitment if hand-holding is wanted. |
| D3 | **Usage limits: build 2-conversations/day caps + 24h cooldown?** | Don't build for the pilot. Watch natural behavior first (that's what a pilot is for); the transcript's own expectation (~20% utilization) predicts no overload at this cohort size. If listener exhaustion *appears*, add limits then — as server config (pattern: `services/paths_data.py`), changeable without an app release. |
| D4 | **Listener compensation?** | Unpaid for the pilot, consistent with the volunteer-listener model and honest-money rulings (§H). If the founder wants to test paid dynamics, run it as a *separate labeled experiment* with 3–5 listeners in weeks 3–4 and log it as a Module B data point — not as the default. |
| D5 | **Listener admissions: keep admin approval?** | Yes — the shipped funnel (apply → admin queue → approve, audited) *is* the pilot listener onboarding. "Anyone becomes a listener without approval" is rejected; visible path, locked door. |
| D6 | **Platform: Android-only or both?** | Android-only. UPSC demographic skews Android, it halves device support, and the existing sideload path already works. iOS joins at launch, not pilot. |
| D7 | **Pilot gate numbers in §7** | Ratify or adjust each threshold — but *before* the pilot starts, so feedback can't move the goalposts. |

## 4. Cohort, recruitment, roles

- **Members:** up to 50, recruited relationally (founder's contacts, UPSC-leaning), consented to test everything including journals and reflection.
- **Listeners:** 15–20. **All apply through the in-app funnel** (Profile → Become a listener) and get admin-approved — this doubles as the funnel's real-world test. The `mentor_interest` checkbox gives us the Module B demand signal for free.
- **Capacity sanity check (repo terms):** 50 members at the transcript's expected ~20% engagement ≈ 10–20 conversations/day across 15–20 listeners ≈ ~1/listener/day. No caps needed at this scale (supports D3).
- **Anonymity holds inside the app:** participants know each other contextually, but personas-only in chat, listeners never see member identity (T&S #7). The pilot must not normalize identity leakage "because it's just friends."

## 5. Prerequisites — Week 0 (all are *existing* repo work, nothing new invented)

Blocking (the pilot cannot run without these):

1. **Deploy the API** — Dockerfile + entrypoint + `docs/DEPLOYMENT.md` exist (session 20); H1-remainder PRD Milestone B adds the DO App Platform spec + Sentry. Currently the API runs on the founder's LAN — that cannot serve 70 remote users. Prod env gates already enforced by boot invariants: distinct `JWT_SECRET`/`ADMIN_JWT_SECRET`, Stream creds, explicit `CORS_ORIGINS`.
2. **Instrumentation** — H1-remainder PRD Milestone A (PostHog funnel, env-gated, anonymous, closed event union: `landing_viewed … match_found{wait_bucket} … chat_first_message_sent`, etc.). Without this, "20% utilization" stays a guess forever. Server-side counts (conversations/day, match success, listener load) come from existing admin Overview/DB — no new build.
3. **App distribution** — EAS internal-distribution APK (needs founder `npx eas-cli login`; the durable path already logged in PROGRESS) or, as fallback, sideloaded Expo Go 2.32.20 + the LAN-style setup per participant. EAS Update then pushes JS fixes over the air — **no store review cycle exists in this pilot at all** (the transcript's 1-week-review fear is moot).
4. **Wire a `/health/crisis` monitor** — the endpoint exists (session 19); pointing an uptime monitor at it was already a launch gate. A pilot with real strangers-in-hard-moments makes it a *pilot* gate.
5. **Fix the Stream upsert gap** — approved/admin-created listeners aren't upserted to Stream (only `seed_listeners` does it); in production a funnel-approved pilot listener would break on their first channel. Already logged session 22; small fix, both call sites.
6. **Fix matcher self-match** — pilot members may also be approved listeners; the one-line exclusion via `listener_applications.listener_id` (logged session 22).
7. **Re-verify helplines** (Tele-MANAS 14416 / KIRAN 1800-599-0019) and publish the **privacy policy** (safety-staff access + community/stage data + the applicant-email note) — both are standing launch gates; a pilot with real users inherits them.

Non-blocking but wanted: Sentry DSNs live (Milestone B makes it env-only); Hindi core loop (Milestone C) — nice for the cohort, not a gate.

## 6. Timeline

- **Week 0 (prep):** founder rules D1–D7 → execute §5 → founder walks the full flow on a real device against the deployed API (extends the session 22 phone re-test).
- **Weeks 1–4 (live):** week 1 onboard listeners first (funnel + approval), then members in two waves (25 + 25) so early breakage hits 25 people, not 50. Weekly 30-min listener check-ins (they're the scarce side). Mid-pilot (end of week 2): compare actual conversations/day against the ~20% assumption; if under half of it, the demand model is wrong — better to know at week 2.
- **Week 5 (decision gate):** score against §7, write the verdict, pick the path in §8.
- **During the pilot:** ship fixes via EAS Update; **feature scope is frozen** — a pilot that mutates weekly measures nothing.

## 7. Pass/fail gates — defined now, before feedback can contaminate them [FOUNDER: ratify numbers]

Hard gates (any failure = no public launch until fixed):
- **Zero unresolved safety incidents** — every crisis flag surfaced resources and reached human review; no identity leakage between participants inside the app.
- **The hero promise holds in production:** median cold-open → live chat under 30s; match success ≥ 95% during listener online hours.
- **Reliability:** crash-free ≥ 99.5%; send→delivered p95 < 500ms (both are existing perf targets, now measured off-LAN).

Product gates (these decide the §8 path):
- **Engagement:** ≥ 40% of members who complete onboarding start ≥ 3 conversations across the 4 weeks (returning, not just curious).
- **Value:** ≥ 50% of members answer yes to "did you leave with something usable?" in a week-4 survey (the anti-dependency metric, T&S #5 — *not* time-in-app).
- **Listener sustainability:** ≥ 60% of listeners would continue *unpaid* at pilot load; listener churn ≤ 25%.
- **Module B signal (measured, not built):** % of listener applicants checking `mentor_interest`, and unprompted member requests for expert/paid help — this is the D1 evidence for later.

Analytics discipline throughout (non-negotiable): no message content or PII in any metric; **crisis sessions excluded from every engagement/retention number** (T&S #5/#10).

## 8. Decision gate outcomes — what the report actually changes

- **All gates pass →** public launch prep: iOS build, store listings, Hindi completion, remaining launch gates.
- **Hard gates pass, engagement/value soft-fail →** Module A redesign sprint targeting the measured drop-off step (the funnel events name it) — re-pilot the changed step only.
- **Listener sustainability fails →** the volunteer model needs rework before any scale-up; this is where D4's paid sub-experiment data and the `mentor_interest` rate feed a real Module B decision.
- **Hard gate fails →** stop, fix, re-run the failed dimension. No launch conversation until green.

## 9. Listener care (the transcript's "we should come up with something", made concrete)

- Weekly check-ins (Week 1–4) with a 5-question pulse: load, hardest conversation type, what they needed and didn't have, would-you-continue, one product ask.
- **End-of-pilot impact summary per listener** ("you held N conversations; members reported X") — platform-private recognition, compatible with anonymity (T&S #7): recognition *from Mento*, never public identity.
- **Founding-listener status** carried into launch (badge/roster decision deferred to launch design — must not become a "Verified" badge in v1 chat, DECISIONS §C.4).
- Standing reminder in every check-in: listeners are not therapists; crisis flow owns the hard cases.

## 10. Explicitly out of the pilot

Session caps/cooldowns (D3), payments of any kind (Razorpay dark), Module B builds, iOS, store submission, group anything, membership tiers (permanently out), and any identity/verification surface in chat.
