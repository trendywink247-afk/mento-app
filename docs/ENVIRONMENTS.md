# Development, staging, production, and monitoring

Founder direction, 2 October 2026: all development work belongs under
`H:\Mento gpt`, with the repository at `H:\Mento gpt\Mento`. The Desktop
checkout is excluded. Build and prove changes locally, test releases on the VPS
staging environment, then promote in stages to production.

## Environment ownership

| Environment | Location | Role |
|---|---|---|
| Development | H: checkout, API 18000 / web 18081 | Code, visual review, fast checks; no production data |
| Automated local tests | Dedicated `mento_test` database and Valkey index 1 | Repeatable backend and cross-worker integration tests |
| Staging | VPS B `31.42.125.238` (previously `87.232.72.79`) | Production-like release validation with synthetic users and separate secrets; not deployed yet |
| Production | VPS A `129.121.122.28` | Public member, mentor, and staff services |
| Monitoring | VPS B watches A; A watches B; independent dead-man check | Detect host failure as well as application failure |
| Recovery | Encrypted off-site backups with independently protected retention | Tested restores; never equate a backup file with proven recovery |

Both servers should have useful, bounded roles. Monitoring must keep working while
staging tests run: reserve memory/CPU, limit test concurrency, and never fill the
backup disk with build artifacts. Build web/APK artifacts locally or in CI, not on
the small operations host. Do not add a database replica until B's actual capacity
and stability have been verified. Staging is not an automatic production standby.

## Local commands

Run from `H:\Mento gpt\Mento` in PowerShell:

```powershell
pwsh -File scripts/local/workspace.ps1 init
# Separate terminals:
pwsh -File scripts/local/workspace.ps1 api
pwsh -File scripts/local/workspace.ps1 worker
pwsh -File scripts/local/workspace.ps1 web
# Verification:
pwsh -File scripts/local/workspace.ps1 status
pwsh -File scripts/local/workspace.ps1 check
pwsh -File scripts/local/workspace.ps1 test
```

Open `http://localhost:18081`; API readiness is
`http://localhost:18000/api/v1/health/ready`.

Docker project `mento-h-dev` owns only its own containers, network and named volume.
Postgres is loopback port 15432 and Valkey is loopback port 16379. `init` migrates
`mento_dev`, creates `mento_test`, and seeds only an empty mentor pool. Repeating it
does not add another batch of mentors. Test fixtures truncate only `mento_test`.
`stop-infra` stops these containers without deleting data. Stop API/worker/web in
their own terminals; never kill an unrelated process by port.

The Python launcher explicitly selects local databases and clears inherited
application configuration before loading defaults. It disables the copied `.env`
file and external credentials by default. An optional ignored `.local/stream.env`
can provide only `STREAM_API_KEY` and `STREAM_API_SECRET` for a verified separate
development application. Tests always ignore this opt-in. The web launcher disables
Expo dotenv loading and selects the local API and, when opted in, that application's
publishable key. Existing API/mobile `.env` and `.env.production` files remain
unchanged. These launchers are local-only, with deliberately non-secret dev keys;
never install them as production launchers.

**Current chat transport:** the application UI still uses Stream. On October 2,
fingerprint comparisons confirmed the copied development API key differs from
both VPS applications. That development application was explicitly enabled through
`.local/stream.env`, and real two-party browser chat passed normally and under
reduced motion. Own-chat server integration tests exercise real sockets independently
of the UI. A live crisis-webhook drill still requires a reachable development-only
webhook endpoint: automatic approval review blocked downloading/starting a public
tunnel in this session. Existing development webhook settings were not changed;
ordinary message delivery is not proof of crisis-hook enforcement. Never repoint
production's webhooks for testing.

Browser scripts that accept `MENTO_WEB`/`MENTO_API` can target these ports:

```powershell
$env:MENTO_WEB = 'http://localhost:18081'
$env:MENTO_API = 'http://localhost:18000/api/v1'
# Set NODE_PATH to an installed Playwright package if not already configured.
cd apps/mobile
node e2e/age-gate.e2e.js
node e2e/session-refresh.e2e.js
```

Do not run the historical `scripts/lanes/gate.sh` unchanged: it hard-codes legacy
container names and resets their data. Several other specs also execute Docker
commands against those names. Audit and parameterize them before expanding this
isolated gate. The new local baseline uses only specs that do not mutate those
containers. Tests involving Stream, native Android, and release/OTA behavior remain
separate acceptance requirements.

## Server access findings

The files in this checkout identify B as Hostinger, user `mento-ops`, with the
existing local `~/.ssh/id_ed25519` trusted historically. A dedicated
`backup_to_old` key on A is restricted to SFTP and is not an interactive SSH key.

On October 2, the founder supplied B's changed IP: `31.42.125.238`. SSH succeeded
with strict validation against the old address's trusted host key. Use
`ssh -F deploy/ssh.config mento-staging`; production is
`ssh -F deploy/ssh.config mento-production`. No global SSH config edits are needed.
B has 2 CPUs, 1,918 MiB RAM and a 30 GiB disk (22 GiB free). It still runs the old
app stack and Uptime Kuma, plus backup and external-monitor cron jobs. The earlier
timeouts were against the obsolete IP. The unrelated `72.61.253.224` host remains
excluded. Preserve existing data/services while planning staging resource limits.

The prior read-only production audit found A running the legacy Nginx/API/Postgres/
Redis stack, release `92b8f57a5cd3`, not Balanced. Off-site backup logs recorded
success through September 29 and failures September 30/October 1. Reconfirm these
facts before making a release decision; this local setup does not repair them.

## Staging isolation contract

- Separate Compose project, network, volumes, database and cache; no production
  mounts, datasets, JWT secrets, message keys, push credentials or Stream project.
- Use production invariants (`ENV=staging`), migration-first startup, bounded pools,
  a job worker, and the same built API/web artifacts intended for promotion.
- Staff-only access initially through a verified SSH tunnel or private network.
  Public staging webhook ingress, if needed, must have its own hostname/TLS and
  correct trusted-proxy setting; authentication remains mandatory.
- Synthetic test identities only; external sends off unless a specific test token
  is allowlisted. Test jobs, seeders and resets must reject production targets.
- Reserve monitoring/backup capacity before allocating staging containers. Recover
  and inventory B before choosing exact limits or installing a staging stack.
- Monitor A's health/readiness, safety assurance, jobs, disk and backup freshness.
  Monitor B from outside B; use an independent dead-man heartbeat because two
  hosts managed together can fail together.

## Promotion gates

1. **Local:** reproducible startup, clean migration check, isolated Postgres tests,
   TypeScript, normal/reduced-motion browser flows and relevant native tests.
2. **Staging:** restore rehearsal, apply migrations to the previous release's
   schema, run member/mentor two-party chat, crisis, recovery, erasure, push and
   reconnect flows. Verify logs contain no private content. Prove alerts reach the
   operator. Run realistic load and deployment-overlap checks within resource caps.
3. **Release candidate:** record API SHA/image digest, web build SHA, mobile
   build/runtime/channel, schema revision, config version and acceptance results.
   Promote these artifacts, not an unreviewed moving branch or a fresh build.
4. **Production infrastructure:** verified backup first; compatible migration;
   health-gated switch; then worker and static web. Watch API errors, queue age,
   safety signal health and mentor availability. Keep rollback artifacts available.
5. **Mobile/transport:** release to a limited test cohort before broad rollout.
   Own-chat cutover requires both clients and an installed-old-client strategy;
   rolling back application code alone does not migrate message history to Stream.

No deployment is ready while staging is unreachable or the relevant acceptance
checks fail. Existing GitHub web deployment can push directly from master: do not
push/merge a release there until that workflow is aligned with these stages.

## Design and architecture direction

Keep the modular monolith and shared design system. Preserve anonymous identities,
server-side safety checks, scoped staff access, explicit deletion, companion-driven
theming, EN/HI, reduced motion, and no audio. Separate domain services from transport;
use Postgres as the durable source of truth and Valkey for ephemeral coordination.
Keep jobs transactional where required and test restart/replay boundaries. Finish
the existing v1 before separately specifying deferred paid mentoring or Community.

The September 20 architecture book remains a useful target-design reference. Its
prices, capacity and recovery estimates are not acceptance evidence. Document live,
implemented-but-undeployed, and planned capabilities separately.
