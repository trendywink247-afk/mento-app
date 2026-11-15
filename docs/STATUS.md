# Status

Updated 2026-11-15. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% -> ~10% on build 15 (measured 2026-11-14, Nothing Phone: display holds 60 Hz, 0 frames in 30 s, Perfetto: 8.1% is RN 0.83 Fabric's DispatchUIFrameCallback re-posting every vsync (RN core, no flag; not patching), 0.6% the shake-to-update accelerometer (could be QA-only), JS 0.5%. Our side is idle-clean; closed). Local CI/CD merged into `dev` (61a8916: ci.sh tiers, SonarQube, scanner configs, IDOR matrix; last Actions/Dependabot files removed; full `ops/ci.sh` 28 pass, container drills skipped); weekly `ops/security-scan.sh` + `ops/deps-check.sh` replace the security workflow and Dependabot (first scan: nothing new and real). Production stack authored (`docs/PRODUCTION.md`), not installed. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**In progress:** §R phases 1-4 committed locally (c41d446, full CI green), JS on QA by OTA; API not yet deployed to QA. §R phase 5 built (local commit after this, not pushed): tiers (`services/tiers.py`, admin `POST /admin/listeners/{id}/tier`), Connect now / Start mentorship, intake form + marks (`/me/mentee-profile`, note crisis-scanned, erased, exported), Browse filters + tier marks + exam emblems, tier in pushes, email confirmation by code (off; placeholder sender). Migration `el01mentortiers01`. PRIVACY.md updated.

**Next 3 tasks:**
1. Founder review of the safety-gated parts (note crisis scan, erasure/export of the form, email confirmation), then deploy API + JS to QA and test on a phone; push `dev` after.
2. Admins set tiers (every non-verified mentor is a Peer listener until promoted; Start mentorship reaches only Mento Verified until then); hide seed mentors; Hindi copy for §R.
3. Production cutover: founder keys, DNS, approve dev -> main, first `ops/prod-release.sh` (set `MENTOR_NAME_ROTATION_ENABLED` false).

**Open questions:**
- Open: Essay paper in marks (R.14); real intake form fields; email service.
- Still queued behind §R: the Stream-removal decision (docs/OWN_CHAT_PARITY.md); ZAP against QA; enable the weekly scan/deps timers; fix `ops/sonar-scan.sh`.
- Founder: prod `MESSAGE_KEY`, FCM file, Stream keys (until removal), prod Sentry DSNs, OTA prod key, backup recovery key + remote.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
