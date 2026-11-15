# Status

Updated 2026-11-15. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% -> ~10% on build 15 (measured 2026-11-14, Nothing Phone: display holds 60 Hz, 0 frames in 30 s, Perfetto: 8.1% is RN 0.83 Fabric's DispatchUIFrameCallback re-posting every vsync (RN core, no flag; not patching), 0.6% the shake-to-update accelerometer (could be QA-only), JS 0.5%. Our side is idle-clean; closed). Local CI/CD merged into `dev` (61a8916: ci.sh tiers, SonarQube, scanner configs, IDOR matrix; last Actions/Dependabot files removed; full `ops/ci.sh` 28 pass, container drills skipped); weekly `ops/security-scan.sh` + `ops/deps-check.sh` replace the security workflow and Dependabot (first scan: nothing new and real). Production stack authored (`docs/PRODUCTION.md`), not installed. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**In progress:** §R phases 1-5 + QA walkthrough fixes + admin tier rework (R.16, option b) + emblem redraw on QA (API 448c880, web/APK build 16, OTA ebcea95) and pushed on `dev` (437b364, full CI green). Phone pass 2026-11-15 done: no-companion signup, Mentor tier on both sides, mentorship request + form in the brief, mentor chat header/menu, emblems in Browse list and profile (founder approved), tier in pushes. QA test data: Kind Maple and Open Meadow are Mentors; admin "Founder QA" kept on purpose.

**Next 3 tasks:**
1. Hindi copy for §R (incl. the new document-screen wording) and resume the remaining phone checks in the Island/clone installs if wanted.
2. Founder decisions below, then any follow-ups; empty gap on the Ready screen when no companion is chosen.
3. Production cutover: founder keys, DNS, approve dev -> main, first `ops/prod-release.sh` (set `MENTOR_NAME_ROTATION_ENABLED` false).

**Open questions:**
- Founder: same persona as member and mentor (Calm Peak) may link the two roles; plain End has no confirm; tapping an active Away Mask/Quiet Pause turns it off silently.
- Open: Essay paper in marks (R.14); real intake form fields; email service.
- Still queued behind §R: the Stream-removal decision (docs/OWN_CHAT_PARITY.md); ZAP against QA; enable the weekly scan/deps timers; fix `ops/sonar-scan.sh`.
- Founder: prod `MESSAGE_KEY`, FCM file, Stream keys (until removal), prod Sentry DSNs, OTA prod key, backup recovery key + remote.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
