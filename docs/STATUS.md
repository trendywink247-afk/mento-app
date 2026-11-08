# Status

Updated 2026-11-08. v1 scope only (CLAUDE.md); Module B, the UPSC self-assessment suite and Community stay deferred (thinking in `docs/proposals/self-assessment-and-community.md`).

**State:** Own chat is proven on QA for allowlisted members (live both ways, replay, direct FCM push, tap routing). The side-by-side "Mento QA" app (`chat.mento.app.qa`) is how the phone is tested; OTA on channel `preview`. Section N of DECISIONS (2026-11-08): the Path can be set before connecting; exam roads (UPSC, NEET, JEE and 13 more) wait for a mentor's accept, life in general keeps the instant match; with nobody online the screen offers Become a mentor / Invite a mentor.
PRs open (2026-11-08, #118 to #123, none merged): `feat/qa-side-by-side` > `feat/chat-composer-fixes` > `feat/exam-paths-accept` > `feat/path-accept-app` (stacked); `feat/decisions-path-accept`; `feat/ci-streamline` (Maestro removed, `master` to `main`, split mobile jobs; the repaired release path is not exercised yet).

**Next 3 tasks:**
1. Merge the PRs in order (#118 > #119 > #120 > #121; #122, #123 separate); deploy `feat/path-accept-app` to QA (`qa-release <sha>`, root) so the accept flow can be tested on the phone.
2. Test mentor and mentee sides together on devices (Island profile = mentor): accept, decline, snooze, End, report, crisis view, push.
3. Chat-list preview for own chats (needs last message in the list response); the undismissable Feedback sheet (needs a repro); rotation, dark mode, large font, TalkBack.

**Open questions:**
- Run the Rollback Rehearsal on GitHub before relying on the `main` repair in the release workflows.
- Production URL/host, FCM key mount, Play Console declarations, trademark check, privacy policy finalisation.
- Safety gap to rule on: a request's intro text (Personal request and the new ask) is not crisis-scanned when it is created, only once it is sent as the first chat message after a mentor accepts. Mentors see it in the inbox before that. Needs your decision (scan at creation, flag, and show the helpline card).
- Erasure for suspended/banned members is blocked (403): product/legal decision. 426 upgrade screen in the app is still to do.
- Revoke the "Founder QA" admin when testing is done.
