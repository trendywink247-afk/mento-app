# Status

Updated 2026-11-15. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% -> ~10% on build 15 (measured 2026-11-14, Nothing Phone: display holds 60 Hz, 0 frames in 30 s, Perfetto: 8.1% is RN 0.83 Fabric's DispatchUIFrameCallback re-posting every vsync (RN core, no flag; not patching), 0.6% the shake-to-update accelerometer (could be QA-only), JS 0.5%. Our side is idle-clean; closed). Local CI/CD merged into `dev` (61a8916: ci.sh tiers, SonarQube, scanner configs, IDOR matrix; last Actions/Dependabot files removed; full `ops/ci.sh` 28 pass, container drills skipped); weekly `ops/security-scan.sh` + `ops/deps-check.sh` replace the security workflow and Dependabot (first scan: nothing new and real). Production stack authored (`docs/PRODUCTION.md`), not installed. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**In progress (uncommitted, checks green, not yet on QA):** DECISIONS §R from the 2026-11-14 QA walkthrough — signup copy; email Continue asks for an address; companion optional (Skip, Profile switch); Ready fits large fonts; Screen 1 stays plain; Light default; name rotation off by default; `GET /app-config` with the signup-verification stub and the email-required switch (both off).

**Next 3 tasks:**
1. QA-test the §R batch on a phone, then commit to `dev`; Hindi copy for the changed §R lines still needs translating.
2. §R phase 5 (tests + founder review each): three tiers; New chat popup (Connect now / Start mentorship); intake form (example fields); Browse filters, cards, exam badges; tier in notifications; email required from the second visit (no email service yet).
3. Production cutover: founder keys, DNS, approve dev -> main, first `ops/prod-release.sh` (prod secrets still set `MENTOR_NAME_ROTATION_ENABLED`; set it false at cutover).

**Open questions:**
- Still queued behind §R: the Stream-removal decision (docs/OWN_CHAT_PARITY.md); ZAP against QA; enable the weekly scan/deps timers; fix `ops/sonar-scan.sh`.
- Founder: prod `MESSAGE_KEY`, FCM file, Stream keys (until removal), prod Sentry DSNs, OTA prod key, backup recovery key + remote.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
