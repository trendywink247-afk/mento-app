# Status

Updated 2026-10-23, during the repository consolidation (feat/consolidation → dev). CLAUDE.md now has a Scope section: v1 only; Module B mentoring, UPSC self-assessment suite and Community are deferred. feat/api-compat adds the T&S-reviewed X-App-Version 426 middleware and the OpenAPI breaking-change check.

**Current state:** dev = master (d23d591) + consolidation. Stale docs, the old CLAUDE.md, PROGRESS.md and project skills are in docs/archive/ (stale). QA cutover to Caddy completed 2026-10-23: `qa-api`/`qa-app`/`qa-admin.mento.chat` live on `129.121.171.140`, Nginx + certbot disabled on that box (not removed), `staging.mento.chat` kept serving as an alias pending a later retirement, QA reachable over the operator's Tailscale network, web releases installed by root via `/usr/local/sbin/qa-install-web` — full record in `infra/caddy/*.md` on `feat/qa-caddy`. Production promotion has stayed locked since the 2026-10 log. Old branches survive as archive/* tags. `feat/qa-ops` adds `docs/environments.md` and `ops/` (ci.sh, build-api.sh, qa-deploy-api.sh); qa-deploy-api is untested on a real host. It also adds QA's SOPS-encrypted env files in `deploy/staging/secrets/` and their `.sops.yaml` rule.

**API compat:** `python3 scripts/ci/openapi_compat.py check` fails on breaking OpenAPI changes (`update` refreshes services/api/openapi.snapshot.json). ops/ci.sh runs it (and the scripts/ci unittests) as required steps. X-App-Version: set `MIN_APP_VERSION` to enable 426; unset = off. Follow-up: upgrade screen in the app for 426 `upgrade_required` (today it only surfaces as ApiError).

**Next 3 tasks:**
1. Root: install `ops/qa-deploy-api.sh` to /usr/local/sbin and rehearse deploy + `--rollback` on QA. Audit production (Mon) and replace the TBDs in docs/environments.md and the CLAUDE.md table. Follow-up: qa-deploy-api should render secrets from sops (needs /etc/mento/age/qa.key).
2. Decide the replacement for GitHub Actions staging/production release before removing Actions. The release workflows are the only callers of the server-side receiver.
3. Upgrade ruff (0.8.4 → current) in services/api and services/recovery_receiver together, with lint fixes.

**Open questions:**
- `deploy/staging/compose.yml`'s `migrate` service still inherits the literal `mento-api:staging-6e47f7a` image tag (not interpolated) — any migration run on the box must name the current image explicitly, e.g. `docker run --rm --network mento-staging_default --env-file /opt/mento-staging/secrets/api.env mento-api:<current-tag> alembic upgrade head`, bypassing that stale pinned tag.
- Where do monitoring (Uptime Kuma, external-monitor.sh) and off-box backups run now? deploy/ still points them at `31.42.125.238` — now confirmed stale, the box is `129.121.171.140`.
- Does the receiver (`ci-receiver.py`) have its own API rollback, and should `qa-deploy-api` replace or sit beside it?
- Erasure for suspended/banned members: currently blocked (403). Needs a product/legal decision — data-erasure rights vs. preserving safety-report evidence.
- Should code comments that point at moved docs (e.g. docs/superpowers specs) be updated or left?
- npm advisories in docs/DEPENDENCY_AUDIT_2026-10-05.md: still open?
