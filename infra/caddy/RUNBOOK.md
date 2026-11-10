# QA cutover runbook: Nginx → Caddy (this box, 129.121.171.140)

**Status: COMPLETED 2026-10-23.** Caddy is live for `qa-api`/`qa-app`/
`qa-admin.mento.chat`; Nginx and its certbot renewal timer are both
disabled (not removed — step 6's rollback below still works). The
required 403 test in 4b passed before Nginx was disabled. Stream's
webhooks have since been repointed at `qa-api.mento.chat`
(`infra/caddy/CHANGES.md` item 5) — `staging.mento.chat` is kept serving
through Caddy as an alias for now (same allowlist, same behaviour), to be
retired in a later, separate change. The steps below are kept as the
as-run record and for the next time this needs doing elsewhere.

Read this with `infra/caddy/NOTES.md` (what's live today, the allowlist
drift) and `infra/caddy/CHANGES.md` (app/config changes — run those
**separately**, item 5 especially, not as part of this cutover). This
runbook only swaps the edge process; it does not touch the API, the
database, or Stream.

**Pre-flight, already true on this box** (checked read-only, no sudo): Caddy
is already installed, but as Ubuntu's packaged 2.6.2 (`caddy.service`
exists, currently `disabled`/`inactive`, stock placeholder
`/etc/caddy/Caddyfile`). Step 1 below replaces it with a current build from
Caddy's own apt repo rather than reusing that one.

All commands below run as **root**, over `ssh mento` then `sudo -i` (or
prefix each command with `sudo`).

## 1. Install Caddy from the official Caddy apt repo (not Ubuntu's 2.6.2)

Ubuntu's own `caddy` package (2.6.2, already on this box, currently
`disabled`/`inactive`) is well behind current Caddy — use upstream's repo
instead, per [Caddy's install docs](https://caddyserver.com/docs/install#debian-ubuntu-raspbian):

```bash
apt-get remove -y caddy   # the stale Ubuntu-repo package, if still installed
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y caddy
caddy version   # confirm it's the upstream build, not 2.6.2
systemctl status caddy --no-pager
```

## 2. Stage the real Caddyfile (DNS must already point qa-*/staging at this box)

```bash
# From the repo checkout on this box:
cd /srv/mento/mento-app
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

### 4a. From an allowlisted host (your operator IP, or over Tailscale)

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://staging.mento.chat/api/v1/health/ready   # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" https://qa-api.mento.chat/api/v1/health/ready     # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" https://qa-app.mento.chat/                         # expect 200
curl -sS -o /dev/null -w "%{http_code}\n" https://qa-admin.mento.chat/                        # expect 302 -> /admin
curl -sS -o /dev/null -w "%{http_code}\n" https://staging.mento.chat/                          # expect 200
openssl s_client -connect qa-api.mento.chat:443 -servername qa-api.mento.chat </dev/null 2>/dev/null | openssl x509 -noout -dates
```

### 4b. REQUIRED: the non-allowlisted 403 test

Do not proceed to step 5 until every row below matches, from a host that is
genuinely off the allowlist (phone on mobile data, Tailscale off — not just
a different terminal on the same allowlisted network). This is the one
check that actually proves the allowlist is doing something — §2 of
NOTES.md found the live Nginx config currently isn't:

| Host | Path | Expected |
|---|---|---|
| `qa-app.mento.chat` | `/` | **403** |
| `qa-admin.mento.chat` | `/` | **403** |
| `staging.mento.chat` | `/` | **403** |
| `qa-api.mento.chat` | `/` (anything not listed below) | **403** |
| `qa-api.mento.chat` | `/api/v1/health/ready` | **200** |
| `qa-api.mento.chat` | `/api/v1/stream/webhook` | **not 403** (expect the API's own response, e.g. 400/401 for an unsigned POST — not the Caddy block) |
| `qa-api.mento.chat` | `/api/v1/stream/before-message-send` | **not 403** (same — the API answers, Caddy doesn't block it) |
| `staging.mento.chat` | `/api/v1/health/ready` | **200** |

```bash
for host in qa-app.mento.chat qa-admin.mento.chat staging.mento.chat; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" "https://$host/")
  echo "$host / -> $code"; [ "$code" = 403 ] || echo "FAIL: expected 403"
done
code=$(curl -sS -o /dev/null -w "%{http_code}" https://qa-api.mento.chat/anything-not-exempt)
echo "qa-api / -> $code"; [ "$code" = 403 ] || echo "FAIL: expected 403"
for path in /api/v1/health/ready; do
  for host in qa-api.mento.chat staging.mento.chat; do
    code=$(curl -sS -o /dev/null -w "%{http_code}" "https://$host$path")
    echo "$host$path -> $code"; [ "$code" = 200 ] || echo "FAIL: expected 200"
  done
done
```

### 4c. End-to-end, from an allowlisted browser

Open `qa-app.mento.chat`, send a chat message end-to-end, and confirm
Stream's dashboard still shows deliveries against the **old**
(`staging.mento.chat`) webhook URL at this point in the sequence —
CHANGES.md item 5 (repointing the webhooks to `qa-api.mento.chat`) is a
deliberate, separate step done only after this cutover is verified, which
is what happened here.

## 5. Disable Nginx (only after 4a–4c all pass)

```bash
systemctl disable nginx
systemctl status nginx --no-pager   # Active: inactive (dead); Loaded: ... disabled
```

Leave it installed, just disabled — this is what makes step 6's rollback a
two-command affair instead of a reinstall. Do not run this until the
required 403 test in 4b has actually passed; disabling Nginx before that
means a failed allowlist on Caddy is fully public with no fallback.

## 6. Rollback to Nginx (under a minute)

```bash
systemctl stop caddy
systemctl start nginx   # works even if step 5 already ran: disable ≠ remove
systemctl status nginx --no-pager   # Active: active (running)
curl -sS -o /dev/null -w "%{http_code}\n" https://staging.mento.chat/api/v1/health/ready   # expect 200
```

Nothing about Nginx's install or its `sites-enabled/mento-staging.conf`
was touched by this cutover, so `nginx` comes back exactly as it was —
this is a two-command, <10-second rollback, not a reinstall. Caddy stays
installed but stopped; re-attempt the cutover once the blocker is fixed.

**If the rollback reason is a cert/ACME failure specifically:** Caddy only
holds *new* certs for `qa-*` in its own storage (`/var/lib/caddy`) — Nginx's
existing Let's Encrypt cert is for `staging.mento.chat` only (confirmed:
`/etc/letsencrypt/live/` on this box holds no `app.staging`/`admin.staging`/
`api.staging` certs — those site templates in `sites-available/` were never
provisioned, matching §3's finding that admin/api were never actually
served here), and that one cert is untouched by any step above, so Nginx's
rollback has no TLS gap.
