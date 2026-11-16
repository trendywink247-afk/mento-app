# Status

Updated 2026-11-16. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% -> ~10% on build 15 (measured 2026-11-14, Nothing Phone: display holds 60 Hz, 0 frames in 30 s, Perfetto: 8.1% is RN 0.83 Fabric's DispatchUIFrameCallback re-posting every vsync (RN core, no flag; not patching), 0.6% the shake-to-update accelerometer (could be QA-only), JS 0.5%. Our side is idle-clean; closed). Local CI/CD merged into `dev` (61a8916: ci.sh tiers, SonarQube, scanner configs, IDOR matrix; last Actions/Dependabot files removed; full `ops/ci.sh` 28 pass, container drills skipped); weekly `ops/security-scan.sh` + `ops/deps-check.sh` replace the security workflow and Dependabot (first scan: nothing new and real). **Production live 2026-11-15** (main 1f4eed5, `prod-1f4eed5c956d-r1`): own chat, no Stream (M.6), no chat bodies in backups (M.7); HTTPS on app/api/admin, admin Tailscale-only, prod OTA server running, nightly encrypted backups to two recipients. Prod now main 7357cf3 (public /privacy/ and /delete-account/ pages for Play). **Play bundle 21** built 2026-11-16 from main 8de9bf6 (new upload key D0:14:1F…, no ACTIVITY_RECOGNITION or READ_MEDIA_IMAGES); fingerprint 3bd506e4 in prod `state/store_fp`. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**In progress:** Play build 21 (main 8de9bf6: new logo, no READ_MEDIA_IMAGES) for Closed testing; upload key valid 2026-11-18 17:00; discard the old version-10 draft. Profile rework per DECISIONS §S: map page drafted for the founder; Theme page on QA (uncommitted until QA check).

**Next 3 tasks:**
1. Play: upload build 21 to Closed testing after 2026-11-18 17:00 (12+ testers, 14 days); store listing, screenshots and forms done.
2. Profile (§S): founder confirms the map; then Mains/Interview tags, hide verification at launch, Peer info page, Profile groups A/B/C.
3. Retire the old server 129.121.122.28; GitHub: drop the two dead required status checks on `main`.

**Open questions:**
- Open: Essay paper in marks (R.14); real intake form fields; email service.
- Still queued behind §R: removing Stream code (prod never uses it; docs/OWN_CHAT_PARITY.md); ZAP against QA; enable the weekly scan/deps timers; fix `ops/sonar-scan.sh`.
- Founder: prod Sentry DSNs (optional), off-box backup remote; pre-release dumps have no expiry yet; native Hindi review.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
