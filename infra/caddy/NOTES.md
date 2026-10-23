# QA → Caddy: findings (read-only recon, no sudo)

Scope: this box (`129.121.171.140`), which today serves only
`staging.mento.chat` behind host Nginx. All of this was read directly off the
box (`/etc/nginx/*`, no edits) plus the repo's `deploy/` tree. (The repo's
`deploy/staging/README.md`, `deploy/ssh.config` and `deploy/staging/release.json`
still describe this host as "VPS B, `31.42.125.238`" — that no longer matches
the box's actual address, confirmed by `hostname -I`. Fixing those is outside
this plan's scope; flagging it here so it isn't mistaken for a typo in this
plan instead of a stale fact elsewhere in the repo.)

## 1. How a staging release switches traffic today

There is **no blue/green swap on this box**. `deploy/staging/compose.yml`
runs one `api` service bound to `127.0.0.1:18010` (and `postgres`/`valkey`/
`worker`, all un-published). A release:

1. builds/transfers the `mento-api:staging-<sha>` image and a new static web
   archive (`deploy/staging/release.json` records the installed hashes),
2. runs `alembic upgrade head` in a one-off `migrate` container,
3. `docker compose up -d --wait` recreates the single `api` container on the
   new image — Compose's healthcheck gate is the only safety net; there is a
   short gap while the old container stops and the new one binds `18010`,
4. the web archive is unpacked under `web-releases/<sha>` and `/opt/mento-staging/web`
   is swapped to point at it (atomic symlink flip, per the staging README).

Nginx itself never changes during a deploy: it has proxied a fixed loopback
port (`127.0.0.1:18010`) and served a fixed root path the whole time, so it
needs no reload. This is **unrelated to** `deploy/bluegreen.sh` /
`deploy/deploy.sh`'s `MENTO_STACK=balanced` path, which is production's
Caddy + `api_blue`/`api_green` design (see §4) — QA has never run that path.

## 2. The live IP allowlist — and a drift from the repo template

`deploy/staging/nginx.conf.template` (the committed source of truth,
rendered with `OPERATOR_IP` substituted before install — "never commit the
rendered access configuration") says the intended policy is:

```
allow OPERATOR_IP;
allow 127.0.0.1;
deny all;
location = /api/v1/stream/before-message-send { allow all; ... }
location = /api/v1/stream/webhook             { allow all; ... }
location = /api/v1/health/ready               { allow all; ... }
```
i.e. everything (the web root `/` *and* `/api/`) is allowlisted to the
operator's IP + loopback, **except** those two signed Stream hooks and the
readiness probe, which stay public.

**The config actually installed at `/etc/nginx/sites-available/mento-staging.conf`
(symlinked live in `sites-enabled/`) is missing the `allow OPERATOR_IP; allow
127.0.0.1; deny all;` lines entirely.** It still carries the four `allow all;`
exceptions (ACME + the three above), but with no `deny` anywhere in the file
or in `nginx.conf`/`conf.d/*.conf` (both checked, empty), those `allow all;`
lines are no-ops — nginx's default is already allow. **In practice, right
now, `staging.mento.chat`'s web root and `/api/` are both open to the public
internet, not just to the operator**, since there is no sudo access here to
confirm whether `ufw`/iptables narrows this further (firewall rules under
`/etc/ufw/*.rules` are root-only, `0640`, and `ufw status`/`iptables -L` both
refuse without root) — ports `80`/`443` are listening on `0.0.0.0`, so if a
firewall layer is filtering, it is not visibly blocking the web ports
themselves. **Flagging this as a live finding, not fixing it** (out of scope
for a read-only plan and outside the repo). The Caddy design below restores
the *intended* (template) behavior, not today's drifted live behavior.

A Tailscale interface is already active on this box (`tailscale0`,
`100.72.181.81`), confirming the Tailscale ask is additive to a real existing
setup, not speculative.

## 3. Where admin is served today

**It isn't.** `sites-enabled/` contains only the `mento-staging.conf` symlink.
`sites-available/mento-admin.conf` exists but is an unused template for
`admin.staging.mento.chat` (never linked into `sites-enabled/`), and
`mento-staging.conf`'s single server block has no `/admin` location at all —
only `/api/`, ACME, and a catch-all SPA route. The staging compose stack,
README and `release.json` have no admin host either. `qa-admin.mento.chat`
is new territory on this box, not a lift of something already running.

## 4. `bluegreen.sh` and the Caddy upstream — the minimal change is none

`deploy/bluegreen.sh` already **only** knows about Caddy, not nginx: it
starts/stops Docker Compose services literally named `api_blue`/`api_green`
and leans on `deploy/caddy/Caddyfile`'s `reverse_proxy api_blue:8000
api_green:8000 { lb_policy first; health_uri /api/v1/health/ready; ... }` —
Caddy's own active health checker, not the script, decides which colour gets
traffic. `deploy/deploy.sh` only calls `caddy reload` when the *Caddyfile
itself* changes (new host, new TLS mode); a routine blue/green swap reloads
nothing, because the upstream list never changes — only which of the two
named upstreams answers health checks.

So: **`bluegreen.sh` needs zero code changes to work against Caddy — it
already only works against Caddy.** What it needs is QA's compose file and
Caddy host block to follow the same two-named-upstream convention production
uses. Two honest options, given QA today is a *single* fixed-port container,
not a blue/green pair:

- **Recommended for this cutover:** keep QA's deploy model exactly as it is
  (one `api` container recreated in place on `127.0.0.1:18010`, as described
  in §1). `qa-api.mento.chat`'s Caddy block reverse-proxies straight to that
  one port. No blue/green, no swap logic, nothing to add to `bluegreen.sh` —
  this is the literal "minimal change," because the thing being asked to
  change (a swap mechanism) doesn't exist on this box today. Caddy needs a
  reload only when `infra/caddy/Caddyfile` itself changes (adding `qa-*`,
  later retiring `staging.mento.chat`) — covered by the runbook below.
- **If QA should also pilot zero-downtime swaps:** give QA its own
  `api_blue`/`api_green` services (mirroring `deploy/compose.base.yml` +
  `deploy/compose.prod.yml`) and add the same `reverse_proxy api_blue:8000
  api_green:8000 { lb_policy first; health_uri ...; }` block to
  `qa-api.mento.chat` in the Caddyfile. At that point `deploy/bluegreen.sh`
  runs against QA completely unmodified — same script, same contract,
  different `COMPOSE_FILE`/`API_TAG`. This is more work (a new compose file,
  a shared Docker network for Caddy + the two API containers) and isn't
  needed just to retire nginx, so it's presented as a later option, not part
  of this cutover.

The Caddyfile draft below takes the recommended (single-upstream) option.
