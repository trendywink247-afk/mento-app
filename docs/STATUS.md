# Status

Updated 2026-11-10. v1 scope only (CLAUDE.md); Module B, the UPSC self-assessment suite and Community stay deferred.

**State:** DECISIONS §Q (2026-11-10) is built on stacked branches, not merged: Appearance (Pastel, Light, Dark, System) with one shared bottom bar; 10 in a row; who answers a question (any, Mento Verified, peers); mentor languages; Mento Verified by document (mentor upload, admin Documents tab, file wiped at decision); chat-list long-press and swipe (Pin, Archive, Mute, Delete, Archived row); the Requests page with how it was asked, what they shared, up next and totals; no screenshots inside a chat. Notifications are one per conversation and clear when the chat opens. PR #126 (mentor tab bar, gold invites, broadcast) is merged to dev.
The phone test build is the side-by-side "Mento QA" app, OTA on channel `preview`. New native modules (expo-system-ui, expo-screen-capture, expo-document-picker) need a new APK: System appearance on Android, the screenshot block and picking a document work only on that build.

**Next 3 tasks:**
1. Test on devices (member on the phone's main profile, mentor on the Island profile), then raise the PRs from the stacked branches; deploy the API with `qa-release <sha>`.
2. Build and install the new APK; check System appearance, the screenshot block and the document picker.
3. Mentor-side chat list actions (Pin, Archive, Mute, Delete); the message meter (not reproduced: the server counts correctly, ask the tester for steps).

**Open questions:**
- Production URL/host, FCM key mount, Play Console declarations, trademark check, privacy policy finalisation (now incl. document upload).
- Run the Rollback Rehearsal before relying on the `main` repair; `native-gate` is still a required check on `main` but nothing produces it (admin must remove it).
- Check `ALLOWANCE_IN_A_ROW` in the QA and production env (the secrets file may still say 3).
- A request's intro text is not crisis-scanned at creation; erasure for suspended members is blocked (403); a 426 upgrade screen is still to do.
