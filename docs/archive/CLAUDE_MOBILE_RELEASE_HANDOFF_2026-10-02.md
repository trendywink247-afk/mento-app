# Claude handoff: independent native and iOS readiness audit

Paste the brief below into the available Claude instance. This document does not start another agent or authorize a deployment.

---

Work only in `H:\Mento gpt\Mento`. Do not read, edit, launch, synchronize or commit the Desktop copy. Begin with a **read-only audit**; do not run destructive tests, reinstall dependencies, change SDK versions or contact production services.

Read AGENTS.md and CLAUDE.md, then docs/DECISIONS.md, docs/PRD.md and the newest PROGRESS.md entries. Read:

- docs/ARCHITECTURE_REVIEW_2026-10-02.md
- docs/ENTERPRISE_PLATFORM_PLAN_2026-10-02.md
- deploy/staging/README.md and release.json
- docs/superpowers/plans/2026-09-29-t6.1-flow2-handoff-brief.md
- apps/mobile/eas.json, app.json, app.config.ts, package.json, patches/
- .github/workflows/maestro.yml and apps/mobile/e2e/maestro/

Current baseline: integration branch `codex/local-staging-foundation`; API source 6e47f7a and web source dc8d17c are deployed to isolated staging. Checkout 229b997 records that work; subsequent documentation commits may exist. Do not assume branch HEAD is a production-certified release.

The app declares Expo 55/RN 0.83.10; older documentation says 52 and the September plan proposed later SDKs. Establish the effective supported runtime and actual native patch compatibility from evidence. Browser tests passed but do not close native gates. A recorded Android CI failure delivered the mentor reply through Stream but failed to render it; diagnose subscriptions/rendering and actual run evidence, not another blind timeout increase.

Deliver a report covering:

1. Exact native failure evidence, verified hypotheses and smallest next experiment. Clearly distinguish the historical failure from any newly reproduced failure.
2. iOS build-readiness: bundle ownership evidence, config plugins, native dependencies, Hermes/new architecture, minimum OS, fonts, secure storage, keyboard/safe areas, deep links and push.
3. EAS profiles and effective environment/channel/runtime selection, including the preview request header versus production channel; report a potential conflict separately from proven generated configuration.
4. Signing/App Store Connect/Apple account evidence available in project metadata. Do not print private keys or credentials. Mark external account state unknown if not verified.
5. Physical-device and emulator test matrix: onboarding, two-party chat, crisis, reconnect, recovery, deletion, background push, reduced motion, accessibility and release performance.
6. Privacy manifests, SDK data collection, symbolication and store metadata gaps. Apple anonymous-chat policy is a product gate; do not suggest masking functionality to pass review.
7. Bounded task cards with file ownership, acceptance tests, dependencies and effort ranges. Include what can be done without touching shared app config/package locks.

Return findings in the Claude chat first, with file/line evidence and a proposed report at `docs/CLAUDE_NATIVE_IOS_AUDIT.md`. Do not modify PROGRESS.md, shared docs or source while the integration owner is working. Agree on a separate branch/worktree under `H:\Mento gpt` before concurrent implementation. Never use historical C:\ml or shared-container scripts as-is.

The development Stream application is currently assigned to staging. Do not repoint hooks or run concurrent local real-chat tests against it. Never use production data. Staging access is operator-network restricted, and push is disabled. TestFlight/reviewer access needs a deliberate plan.

Product scope: current communities include UPSC, NEET and JEE; finance/others may follow. Existing anonymous identity and 18+ rules remain. Verified bureaucrat profiles, paid sessions and other professional mentoring are a separately scoped future capability. “RV” was a dictation error for “are we,” not an additional component.

Do not deploy, submit to app stores, create accounts or purchase services as part of this audit. Hand off a reviewable diagnosis and implementation plan to the integration owner.
