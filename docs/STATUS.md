# Status

Updated 2026-11-12. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** No EAS (local builds, self-hosted signed OTA at qa-api/ota, FCM-only push); APK auto-builder live (build 15, 36fab4d). No GitHub automation. Live events socket replaces all polling (0 idle API calls, measured). QA runs own chat for all new conversations (`OWN_CHAT_NEW_CONVERSATIONS=true`); own-chat gaps closed (snooze bug, unread/preview, ended transcripts, web tools, crisis-flag reconcile + own-chat crisis health); `scripts/e2e/own_chat_live.py` passes 12/12 on QA. Idle rendering 114 fps -> 0; idle CPU ~90% -> ~12% (rest is RN Fabric's per-vsync dispatcher; build 15 adds an idle 60 Hz vote, to be measured). Production stack authored (`docs/PRODUCTION.md`), not installed. cryptography 50.0.2; GlitchTip removed; Sentry live for QA.

**Next 3 tasks:**
1. Measure build 15 idle CPU on the phone; then the Stream-removal decision (founder) and, if yes, the staged removal (docs/OWN_CHAT_PARITY.md).
2. Merge local CI/CD (`feat/local-cicd`: ci.sh tiers, security/deps timers, SonarQube 3 GB); ZAP against QA.
3. Production cutover: founder keys, DNS app/api/admin -> 129.121.171.140, approve dev -> main, first `ops/prod-release.sh`.

**Open questions:**
- Founder: prod `MESSAGE_KEY`, FCM file, Stream keys (until removal), prod Sentry DSNs, OTA prod key, backup recovery key + remote.
- Privacy policy sign-off (own-chat storage, export contents), Play Console declarations, trademark; iOS (Mac SSH, Apple account, APNs, Firebase iOS SDK).
- Four test crisis flags from the E2E runs sit in QA's review queue (dismiss as test data).
