# Status

Updated 2026-11-11. v1 scope only (CLAUDE.md). One working branch: `dev`; `main` only with founder approval; prod only from `main`.

**State:** EAS removed: local builds (`ops/build-android.sh`, `ops/build-ios.sh` over SSH to a Mac), self-hosted signed OTA (`services/ota`, live at qa-api.mento.chat/ota, verified on the phone), FCM-only push. The APK auto-builder published build 14 by itself. GitHub automation removed; CI/CD runs locally. Sentry live for QA app and API. SonarQube on 127.0.0.1:9000. cryptography 50.0.2 (13 advisories cleared). GlitchTip removed. IDOR matrix: 55 id routes, no findings.
In progress: live events (one socket per app replaces all six polls; app side done, server side in test); local CI/CD scripts, security and dependency timers.

**Next 3 tasks:**
1. Merge live events, deploy API to QA, publish OTA, measure idle API calls on the phone before/after, k6 socket load test.
2. Merge local CI/CD; SonarQube to 3 GB and rescan; ZAP against QA; triage.
3. Production on this box (Phase 5): separate stack under Caddy, own DB/Valkey/secrets/backups, release from `main` only.

**Open questions:**
- Production domain, `MESSAGE_KEY`, FCM key, Play upload key, prod Sentry DSNs (founder).
- Privacy policy sign-off and public page; Play Console declarations; trademark check; `ALLOWANCE_IN_A_ROW` in prod secrets.
- iOS: Mac SSH access, Apple Developer account, APNs key, Firebase iOS SDK.
