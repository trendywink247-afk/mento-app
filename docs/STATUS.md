# Status

Updated 2026-11-10. v1 scope only (CLAUDE.md); Module B, the UPSC self-assessment suite and Community stay deferred.

**State:** DECISIONS §Q is merged to dev and running on QA (API at 03396ee; app fixes by OTA on channel `preview`): Appearance (Pastel, Light, Dark, System), one shared bottom bar, who answers a question, mentor languages, Mento Verified by document, chat-list actions, the Requests page, no screenshots inside a chat, one notification per conversation, "Show message text", the helpline card on a sent question, erasure for suspended members, the 426 "update the app" screen.
Full QA pass 2026-11-10 (phone, both profiles, four looks, Hindi, font 1.3 and 1.0; API 1039 tests, mobile 151): fixed the My Chats fade/bar overlap and the Hindi Path title. Branch `chore/qa-apk-publish` (not a PR yet) holds those fixes and `ops/qa-apk.sh`, which builds the QA APK (versionCode 11) plus a fresh web export and stages them for `qa-install-web`.
The QA web app and admin console were still the 2026-10-23 build (no Documents or invitations panels) until that release is installed.

**Next 3 tasks:**
1. Root: `sudo qa-install-web /home/agent/qa-apk-out/web-d2b38e6-qa-apk11.tar.gz` (APK page, web app, admin Documents). Then test document approval in the admin UI.
2. Raise the PR from `chore/qa-apk-publish` once approved; optionally install `infra/qa-agent/apk-publish.sh` so APK builds publish themselves.
3. Hindi for path stages and starters (server sends English only); mentor-side chat-list actions.

**Open questions:**
- Production URL/host, FCM key mount, Play Console declarations, trademark check, privacy policy sign-off (document upload, "Show message text", blocked-install hash).
- `native-gate` is a required check on `main` that nothing produces (admin must remove it); run the Rollback Rehearsal.
- `ALLOWANCE_IN_A_ROW` in production secrets; 29 old QA safety flags are unreviewed.
