# Status

Updated 2026-10-22, during the repository consolidation (feat/consolidation → dev).

**Current state:** dev = master (d23d591) + consolidation. Stale docs, the old CLAUDE.md, PROGRESS.md and project skills are in docs/archive/ (stale). Staging release targets 129.121.171.140. Production promotion has stayed locked since the 2026-10 log. Old branches survive as archive/* tags. `feat/ops-qa-api` adds `docs/environments.md` and `ops/` (ci.sh, build-api.sh, qa-deploy-api.sh), committed locally, not pushed; qa-deploy-api is untested on a real host. `feat/ops-prod` (stacked, local) adds `ops/deploy-api.sh <qa|prod>`, `deploy/compose.prod-cutover.yml`, `infra/caddy/Caddyfile.prod` and `docs/runbooks/prod-cutover.md` (draft, never run).

**Next 3 tasks:**
1. Root: install `ops/qa-deploy-api.sh` to /usr/local/sbin and rehearse deploy + `--rollback` on QA. Audit production (Mon) and replace the TBDs in docs/environments.md and the CLAUDE.md table.
2. Decide the replacement for GitHub Actions staging/production release before removing Actions. The release workflows are the only callers of the server-side receiver.
3. Upgrade ruff (0.8.4 → current) in services/api and services/recovery_receiver together, with lint fixes.

**Follow-up:** create chat_messages partitions beyond 2026-12 (the migration makes current+2; the worker's daily job keeps 2 ahead once prod runs one).

**Open questions:**
- Does the receiver (`ci-receiver.py`) have its own API rollback, and should `qa-deploy-api` replace or sit beside it?
- Where do monitoring (Uptime Kuma, external-monitor.sh) and off-box backups run now? deploy/ still points them at 31.42.125.238.
- Should code comments that point at moved docs (e.g. docs/superpowers specs) be updated or left?
- npm advisories in docs/DEPENDENCY_AUDIT_2026-10-05.md: still open?
