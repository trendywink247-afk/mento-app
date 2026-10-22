# Status

Updated 2026-10-22, during the repository consolidation (feat/consolidation → dev).

**Current state:** dev = master (d23d591) + consolidation. Stale docs, the old CLAUDE.md, PROGRESS.md and project skills are in docs/archive/ (stale). Staging release targets 129.121.171.140. Production promotion has stayed locked since the 2026-10 log. Old branches survive as archive/* tags.

**Next 3 tasks:**
1. Confirm QA and production URLs/hosts, and fill in the CLAUDE.md environments table.
2. Decide the replacement for GitHub Actions staging/production release before removing Actions. The release workflows are the only callers of the server-side receiver.
3. Upgrade ruff (0.8.4 → current) in services/api and services/recovery_receiver together, with lint fixes.

**Open questions:**
- Where do monitoring (Uptime Kuma, external-monitor.sh) and off-box backups run now? deploy/ still points them at 31.42.125.238.
- Should code comments that point at moved docs (e.g. docs/superpowers specs) be updated or left?
- npm advisories in docs/DEPENDENCY_AUDIT_2026-10-05.md: still open?
