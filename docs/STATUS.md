# Status

Updated 2026-11-15. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% -> ~10% on build 15 (measured 2026-11-14, Nothing Phone: display holds 60 Hz, 0 frames in 30 s, Perfetto: 8.1% is RN 0.83 Fabric's DispatchUIFrameCallback re-posting every vsync (RN core, no flag; not patching), 0.6% the shake-to-update accelerometer (could be QA-only), JS 0.5%. Our side is idle-clean; closed). Local CI/CD merged into `dev` (61a8916: ci.sh tiers, SonarQube, scanner configs, IDOR matrix; last Actions/Dependabot files removed; full `ops/ci.sh` 28 pass, container drills skipped); weekly `ops/security-scan.sh` + `ops/deps-check.sh` replace the security workflow and Dependabot (first scan: nothing new and real). Production set up on the box (2026-11-15), not started: own chat, no Stream (M.6), no chat bodies in backups (M.7); `MESSAGE_KEY`, FCM file, OTA prod key (OTA server running) and backup recovery recipient in place. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**In progress:** §R + QA fixes + separate mentor names + End confirm / switch-off notes / Ready layout / Hindi on `dev` (40fbef5, full CI green) and on QA. Production cutover underway.

**Next 3 tasks:**
1. DNS: `app`/`api`/`admin.mento.chat` -> 129.121.171.140 (still the old server), then `prod-root-setup.sh --with-caddy`.
2. Founder OK on the own-chat safety review; approve dev -> main; CI on main; `ops/prod-release.sh` dry run, then release (`MENTOR_NAME_ROTATION_ENABLED=false`).
3. Play build (production variant, prod API, new versionCode); Data safety draft from PRIVACY.md.

**Open questions:**
- Open: Essay paper in marks (R.14); real intake form fields; email service.
- Still queued behind §R: removing Stream code (prod never uses it; docs/OWN_CHAT_PARITY.md); ZAP against QA; enable the weekly scan/deps timers; fix `ops/sonar-scan.sh`.
- Founder: prod Sentry DSNs (optional), off-box backup remote; pre-release dumps have no expiry yet; native Hindi review.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
