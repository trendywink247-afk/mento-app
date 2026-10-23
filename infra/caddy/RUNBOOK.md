# QA cutover runbook: Nginx → Caddy (VPS B, 31.42.125.238)

Read this with `infra/caddy/NOTES.md` (what's live today, the allowlist
drift) and `infra/caddy/CHANGES.md` (app/config changes — run those
**separately**, item 5 especially, not as part of this cutover). This
runbook only swaps the edge process; it does not touch the API, the
database, or Stream.

**Pre-flight, already true on this box** (checked read-only, no sudo): Caddy
2.6.2 is already installed via the `caddy` apt package
(`caddy.service` exists, currently `disabled`/`inactive`), with a stock
placeholder `/etc/caddy/Caddyfile`. So "install Caddy" below is really just
"this is already satisfied — verify, don't re-run it" unless you're on a
different box than the one this was recon'd against.

All commands below run as **root on the VPS**, over SSH
(`ssh -F deploy/ssh.config mento-staging` or your usual root path).

## 1. Install Caddy (skip if already present — see pre-flight above)

```bash
apt-get update && apt-get install -y caddy
systemctl status caddy --no-pager   # confirm the package + unit exist
```

## 2. Stage the real Caddyfile (DNS must already point qa-*/staging at this box)

```bash
# From a checkout of this repo on the box (or scp'd from your workstation):
cd /opt/mento-app   # or wherever this repo is checked out on B
git fetch && git checkout feat/qa-caddy   # or the merged commit, once merged

OPERATOR_IP="<your current public IP>/32"   # never commit this substitution
sed "s#OPERATOR_IP#${OPERATOR_IP}#" infra/caddy/Caddyfile > /tmp/qa-Caddyfile

caddy validate --config /tmp/qa-Caddyfile --adapter caddyfile
```

Stop here if `validate` fails — fix it before touching anything live.

```bash
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%s)   # keep the stock file
install -o root -g caddy -m 640 /tmp/qa-Caddyfile /etc/caddy/Caddyfile
```

## 3. Stop Nginx, start Caddy

Ports 80/443 can't be held by both at once — stop Nginx first.

```bash
systemctl stop nginx
systemctl enable --now caddy
systemctl status caddy --no-pager   # Active: active (running)
```

Caddy will attempt ACME issuance for `qa-api`, `qa-app`, `qa-admin` and
`staging.mento.chat` on first start — this needs those DNS records already
pointed here, and ports 80/443 reachable from the internet (for HTTP-01) or
Caddy's TLS-ALPN fallback. Watch for it:

```bash
journalctl -u caddy -n 100 --no-pager | grep -i -E "certificate|acme|error"
```

## 4. Verify

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://staging.mento.chat/api/v1/health/ready   # expect 200, publicly
curl -sS -o /dev/null -w "%{http_code}\n" https://qa-api.mento.chat/api/v1/health/ready     # expect 200, publicly
curl -sS -o /dev/null -w "%{http_code}\n" https://qa-app.mento.chat/                         # expect 200 from YOUR allowlisted IP
curl -sS -o /dev/null -w "%{http_code}\n" https://qa-admin.mento.chat/                        # expect 302 -> /admin, from YOUR IP
curl -sS -o /dev/null -w "%{http_code}\n" https://staging.mento.chat/                          # expect 200, from YOUR IP (unchanged behaviour)
openssl s_client -connect qa-api.mento.chat:443 -servername qa-api.mento.chat </dev/null 2>/dev/null | openssl x509 -noout -dates
```

From a host that is **not** on the allowlist (e.g. your phone's mobile data,
Tailscale off), confirm `qa-app`/`qa-admin`/`staging.mento.chat`'s `/` give
`403`, while the three exception paths and the readiness probe still answer
normally. This is the one check that actually proves the allowlist is doing
something — §2 of NOTES.md found the live Nginx config currently isn't.

Then exercise the real thing: open `qa-app.mento.chat` from an allowlisted
browser, send a chat message end-to-end, and confirm Stream's dashboard still
shows deliveries against the **old** (`staging.mento.chat`) webhook URL — it
should, since CHANGES.md item 5 hasn't run yet.

## 5. Rollback to Nginx (under a minute)

```bash
systemctl stop caddy
systemctl start nginx
systemctl status nginx --no-pager   # Active: active (running)
curl -sS -o /dev/null -w "%{http_code}\n" https://staging.mento.chat/api/v1/health/ready   # expect 200
```

Nothing about Nginx's install or its `sites-enabled/mento-staging.conf`
was touched by this cutover, so `nginx` comes back exactly as it was —
this is a two-command, <10-second rollback, not a reinstall. Caddy stays
installed but stopped; re-attempt the cutover once the blocker is fixed.

**If the rollback reason is a cert/ACME failure specifically:** Caddy only
holds *new* certs for `qa-*` in its own storage (`/var/lib/caddy`) —
Nginx's existing Let's Encrypt certs for `staging.mento.chat`,
`app.staging.mento.chat`, `admin.staging.mento.chat` and
`api.staging.mento.chat` under `/etc/letsencrypt/` are untouched by any step
above, so Nginx's rollback has no TLS gap.
