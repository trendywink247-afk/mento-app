# Status

Updated 2026-11-16. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% -> ~10% on build 15 (measured 2026-11-14, Nothing Phone: display holds 60 Hz, 0 frames in 30 s, Perfetto: 8.1% is RN 0.83 Fabric's DispatchUIFrameCallback re-posting every vsync (RN core, no flag; not patching), 0.6% the shake-to-update accelerometer (could be QA-only), JS 0.5%. Our side is idle-clean; closed). Local CI/CD merged into `dev` (61a8916: ci.sh tiers, SonarQube, scanner configs, IDOR matrix; last Actions/Dependabot files removed; full `ops/ci.sh` 28 pass, container drills skipped); weekly `ops/security-scan.sh` + `ops/deps-check.sh` replace the security workflow and Dependabot (first scan: nothing new and real). **Production live 2026-11-15** (main 1f4eed5, `prod-1f4eed5c956d-r1`): own chat, no Stream (M.6), no chat bodies in backups (M.7); HTTPS on app/api/admin, admin Tailscale-only, prod OTA server running, nightly encrypted backups to two recipients. Prod now main 7357cf3 (public /privacy/ and /delete-account/ pages for Play). **Play bundle built** 2026-11-16 from main 92f1c12 (versionCode 20, upload-key signed, no ACTIVITY_RECOGNITION); its native fingerprint is in prod `state/store_fp`. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**In progress:** Play rejected the 92f1c12 bundle (an older upload key, SHA-1 8A:68:97…, was registered); upload key reset to this box's key accepted, valid 2026-11-18 17:00. Then upload the same bundle to Internal testing; no rebuild.

**Next 3 tasks:**
1. Play: App content forms (founder, answers given); build 21 = new logo (a7c98af, on dev) + drop READ_MEDIA_IMAGES if approved; Internal, then Closed testing.
2. Play Console forms (Data safety from PRIVACY.md, 18+ audience, privacy URL); a public page for the policy.
3. Retire the old server 129.121.122.28; GitHub: drop the two dead required status checks on `main`.

**Open questions:**
- Open: Essay paper in marks (R.14); real intake form fields; email service.
- Still queued behind §R: removing Stream code (prod never uses it; docs/OWN_CHAT_PARITY.md); ZAP against QA; enable the weekly scan/deps timers; fix `ops/sonar-scan.sh`.
- Founder: prod Sentry DSNs (optional), off-box backup remote; pre-release dumps have no expiry yet; native Hindi review.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
