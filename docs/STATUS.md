# Status

Updated 2026-11-08. v1 scope only (CLAUDE.md); Module B, the UPSC self-assessment suite and Community stay deferred (thinking in `docs/proposals/self-assessment-and-community.md`).

**State:** Own chat is proven on QA for allowlisted members (live both ways, replay, direct FCM push, tap routing). The side-by-side "Mento QA" app (`chat.mento.app.qa`) is how the phone is tested; OTA on channel `preview`. Section N of DECISIONS (2026-11-08): the Path can be set before connecting; exam roads (UPSC, NEET, JEE and 13 more) wait for a mentor's accept, life in general keeps the instant match; with nobody online the screen offers Become a mentor / Invite a mentor.
On dev 2026-11-08 (#118 to #124): QA build beside store, CI streamline, DECISIONS N, composer fixes, exam roads, accept-first and the app side. Proven on the phone with both sides (member + mentor in the Island profile): road picked, ask, waiting letter, 2-minute step, accept, chat, reply. `feat/accept-flow-fixes` (not yet a PR) holds what that run found: wrapped road groups, honest copy on exam roads, mentor roads from the server, application-in-review polling. Stack names: `feat/qa-side-by-side` > `feat/chat-composer-fixes` > `feat/exam-paths-accept` > `feat/path-accept-app` (stacked); `feat/decisions-path-accept`; `feat/ci-streamline` (Maestro removed, `master` to `main`, split mobile jobs; the repaired release path is not exercised yet).

**Next 3 tasks:**
0. Stacked on #125 (merged): certified-mentors > upsc-launch-gate > gold-invites > request-broadcast > request-ageing > `feat/mentor-tab-bar` (CI green at 26762fe; 1008 API / 134 app tests). Adds the mentor bottom bar and the chosen screens (Home week strip, Requests one at a time, Chats Active / Waiting / In touch, Profile), prepared answers with the / shortcut (device only), and the label "Mento Verified". Phone test of all of it is pending; QA deploy: `sudo qa-release 26762fe`.
1. Founder review of `feat/certified-mentors` (certified exam mentors, cap only for them, mentor's "This is about an exam" key, certified-only exam asks; stacked on #125); then `qa-release` it and test on the phone (certify a mentor via the admin panel first).
2. Not on a device yet: the busy card (needs no certified mentor online, which exam asks now cause), the redirect card, rotation, TalkBack, large font beyond My Chats. The app has no dark theme (light only, DECISIONS silent).
3. Decide: proof of certification is a self-declared credential an admin reads (no upload); a Browse empty state when no mentor is certified.

**Open questions:**
- Run the Rollback Rehearsal on GitHub before relying on the `main` repair in the release workflows.
- Production URL/host, FCM key mount, Play Console declarations, trademark check, privacy policy finalisation.
- Safety gap to rule on: a request's intro text (Personal request and the new ask) is not crisis-scanned when it is created, only once it is sent as the first chat message after a mentor accepts. Mentors see it in the inbox before that. Needs your decision (scan at creation, flag, and show the helpline card).
- Erasure for suspended/banned members is blocked (403): product/legal decision. 426 upgrade screen in the app is still to do.
- Revoke the "Founder QA" admin when testing is done. DECISIONS §O (10-message limit only for certified exam mentors; no verification for general listening) is on `docs/decisions-limit-verification`; not built: three open points are listed there.
