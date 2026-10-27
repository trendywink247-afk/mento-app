# Status

Updated 2026-10-27. CLAUDE.md scope: v1 only; Module B mentoring, UPSC self-assessment and Community are deferred. Landed on dev: consolidation, Caddy QA cutover (2026-10-23, `qa-*.mento.chat` on `129.121.171.140`, Nginx disabled not removed, `staging.mento.chat` alias kept; record in `infra/caddy/*.md` on `feat/qa-caddy`), `ops/` (ci.sh, build-api.sh, qa-deploy-api.sh, qa-install-web.sh), QA SOPS env files, X-App-Version 426 + OpenAPI breaking-change check (`MIN_APP_VERSION` unset = off), and Sentry (#97: errors only, scrubbed, off unless DSN + qa/prod env). Production promotion stays locked.

**Current state:** QA mobile testing ran end to end on a real phone (2026-10-27): onboarding, chat, crisis card, recovery, PIN lock, report, End and wipe, Start fresh, mentor application, push (QA `PUSH_ENABLED=true`, `qa-api` open to the internet by founder decision). Fixes are on `feat/android-tab-keyboard-fixes` (tab bar, keyboard, PIN, dates, icon) and live on the `preview` channel by OTA; see `ANDROID_BUILD.md`. `qa-deploy-api` has rehearsed deploy + rollback once on QA (2026-10-23). A plaintext nightly DB dump already runs on QA, local-only. `feat/qa-hardening` adds `ops/ci-poll.sh`, `ops/qa-backup.sh`, `ops/qa-restore-drill.sh` and `infra/systemd/` units, all untested on a host and not installed. Staging/production release workflows still require `master` (gone), so Actions cannot deploy; left alone until prod is decided. test-ci.yml now runs on `main`/`dev` pushes and includes the Sentry test. Maestro CI is disabled by the founder. History scan (regex, 2026-10-25) found no committed keys or tokens; repo is still public.

**Next 3 tasks:**
0. Open the PR for `feat/android-tab-keyboard-fixes` (needs founder OK); mentor-side accept/decline/snooze still untested on a device; the notification channel and icon need a new APK.
1. Root: `sudo infra/qa-root-setup.sh --recovery-recipient age1... [--remote name:path] --enable` (installs qa-deploy-api, qa-backup, drill, timers, seeds the CI poller; see environments.md). Then retire the plaintext dumps.
2. Verify `qa-deploy-api` after reinstall (now dumps the DB first and needs a passing ops/ci log; QA deploy path = `specs/qa-deploy-path.md` option 2). Still to do: render secrets from sops, fix the stale compose image pin, port the receiver's acceptance fixture.
3. Audit production (founder/root) and replace the TBDs in `environments.md` and the CLAUDE.md table. Then upgrade ruff (0.8.4) in api and recovery_receiver.

**Open questions:**
- Repo is public and the agent's `gh` token is the admin account; `protect-default` has no required status check. GitHub lockdown was skipped for now, by the founder.
- Monitoring (Uptime Kuma, external-monitor.sh) and off-box backups still point at `31.42.125.238`; where do they run now?
- `deploy/staging/compose.yml` `migrate` still pins `mento-api:staging-6e47f7a`; name the current image on any hand-run migration.
- Erasure for suspended/banned members is blocked (403): needs a product/legal decision. 426 upgrade screen in the app is still to do.
- Are the npm advisories in `docs/DEPENDENCY_AUDIT_2026-10-05.md` still open?
- Sentry follow-ups: ops scripts must supply GIT_SHA, EXPO_PUBLIC_GIT_SHA, EXPO_PUBLIC_APP_ENV; native crash reporting stays off until a native scrubber exists.
