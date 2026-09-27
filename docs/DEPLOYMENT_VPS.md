# Mento — Test/Prod on a self-managed VPS (Hostinger)

> Companion to `docs/DEPLOYMENT.md` (the DigitalOcean App Platform path). This doc
> is for a **raw VPS** (Hostinger, or any Debian/Ubuntu box) instead of a managed PaaS —
> the difference is Postgres/Redis are self-managed containers here, not a
> managed database, and Nginx + certbot replace DO's built-in load balancer/TLS.

## The two environments

| | Test | Prod |
|---|---|---|
| Where | This laptop | Hostinger VPS |
| Postgres/Redis | `docker compose up -d` (services/api/docker-compose.yml) | `deploy/docker-compose.prod.yml`, self-managed containers |
| API | `uvicorn app.main:app --port 8000` (reload-friendly, foreground) | Dockerized, `restart: always`, behind Nginx+TLS |
| Mobile | `npx expo start --web --port 8081` (Metro dev server) | APK (primary) + the web build at the app host (`app.<root>`, whole app, best-effort UX — §11) |
| Data | Disposable — pytest truncates listeners, safe to nuke | Real user data — back up before every deploy that touches migrations |

**Start Test** (unchanged — full detail in the `mento-stack` skill):

```powershell
cd services/api
docker compose up -d --wait
.\.venv\Scripts\python.exe -m alembic upgrade head
.\.venv\Scripts\python.exe -m scripts.seed_listeners
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000

cd apps/mobile
npx expo start --web --port 8081
```

---

## One-time VPS setup

### 1. The VPS (provisioned)

Actual box in use: Hostinger VPS, **Debian 12 (bookworm), 1–2 GB RAM, 30 GB disk,
2000 GB bandwidth**, IP `87.232.72.79`. This is below the original 4 GB / 80 GB
target for this stack (FastAPI + Postgres + Redis + Nginx) — workable at pilot
scale but tight, so step 2 adds a swap file and step 5 tunes worker/pool counts
down accordingly. Domain: **`api.agentin.chat`** for the live API — point an A
record for `api` at `87.232.72.79` before step 7. (`geekspace.space` is the other
domain on hand — free for a separate project; not used here.)

The runbook below targets **Debian 12**, not Ubuntu — the commands differ slightly
from earlier drafts of this doc (`ufw` isn't preinstalled on Debian's minimal
image; ordinary user accounts aren't in the `sudo` group by default the way
Ubuntu's cloud image sets them up).

### 2. Base server hardening

SSH in as root once, then:

```bash
apt update && apt install -y sudo ufw
adduser mento-ops
usermod -aG sudo mento-ops
# copy your SSH public key into /home/mento-ops/.ssh/authorized_keys, then:
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable

# Swap — this box has only 1-2 GB RAM; without swap, `docker compose build`
# (pip installs) or a Postgres/Redis memory spike can OOM-kill the SSH daemon
# itself, locking you out. 2 GB swap is cheap insurance on a box this size.
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

From here on, SSH in as `mento-ops`, not root.

### 3. Install Docker, Nginx, certbot

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker mento-ops   # log out/in after this
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4. Clone the repo (SSH deploy key)

Private repo — clone over SSH using a **deploy key** (repo-scoped, read-only,
never expires) rather than a PAT:

```bash
# As mento-ops, generate a dedicated key (no passphrase — deploy.sh needs
# non-interactive git):
mkdir -p ~/.ssh && chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/mento_deploy_key -N "" -C "mento-vps-deploy"
cat >> ~/.ssh/config <<'CFG'
Host github.com
    HostName github.com
    User git
    IdentityFile ~/.ssh/mento_deploy_key
    IdentitiesOnly yes
CFG
chmod 600 ~/.ssh/config
ssh-keyscan -H github.com >> ~/.ssh/known_hosts 2>/dev/null
cat ~/.ssh/mento_deploy_key.pub
```

Add the printed public key at **github.com/trendywink247-afk/mento-app →
Settings → Deploy keys → Add deploy key** — leave "Allow write access"
unchecked (pull-only). Then clone:

```bash
sudo mkdir -p /opt/mento && sudo chown mento-ops:mento-ops /opt/mento
git clone git@github.com:trendywink247-afk/mento-app.git /opt/mento
cd /opt/mento
```

### 5. Fill in prod secrets

```bash
cp services/api/.env.example services/api/.env
nano services/api/.env
```

Set at minimum: `ENV=prod`, three distinct random secrets `JWT_SECRET`, `ADMIN_JWT_SECRET`
and `LISTENER_JWT_SECRET` (the API refuses to boot on a missing or shared one),
`POSTGRES_PASSWORD` (new value — this is the VPS path, `DATABASE_URL` itself is
overridden by `deploy/docker-compose.prod.yml`), `APP_BASE_URL`, `ADMIN_BASE_URL`, `CORS_ORIGINS` (hosts from `deploy/domains.env`),
`STREAM_API_KEY`/`STREAM_API_SECRET`, `TRUSTED_PROXY_HOPS=1` (single Nginx hop).
Leave Razorpay/PostHog/Sentry/Gemini blank until those are ready — every one of
those integrations ships dark by design (CLAUDE.md).

**Low-RAM tuning (this box):** uncomment and set `UVICORN_WORKERS=1`,
`DB_POOL_SIZE=3`, `DB_MAX_OVERFLOW=2` in the `.env` you just created — the
Dockerfile defaults (2 workers × (5+5)) assume more headroom than 1–2 GB gives
you. One worker is fine at pilot scale; raise these later if you upgrade the box.

### 6. First deploy

```bash
chmod +x deploy/deploy.sh deploy/backup-postgres.sh
./deploy/deploy.sh
curl http://127.0.0.1:8000/api/v1/health   # expect {"status":"ok"}
```

### 7. Nginx + TLS

```bash
sed "s/API_DOMAIN/api.agentin.chat/g" deploy/nginx/mento-api.conf.template \
  | sudo tee /etc/nginx/sites-available/mento-api.conf
sudo ln -s /etc/nginx/sites-available/mento-api.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.agentin.chat   # provisions TLS, rewrites the server block, sets up auto-renewal
```

Verify from OUTSIDE the box: `curl https://api.agentin.chat/api/v1/health`.

### 8. Point the mobile app + Stream at prod

- **Never hand-edit `apps/mobile/.env`** — it's the permanent local/dev config and is
  read every time you run `expo start`. Prod values live in `apps/mobile/.env.production`
  (gitignored, create once from `.env.example`: `EXPO_PUBLIC_API_URL=https://api.agentin.chat/api/v1`
  + the prod Stream key). It's picked up automatically wherever `NODE_ENV=production` is
  set (Expo's built-in env-file precedence) — the release-build path already does this for
  you via `apps/mobile/scripts/build-android-release.ps1` (see `ANDROID_BUILD.md` §3).
- Re-run `python -m scripts.configure_stream` with the prod URL so Stream's
  before-send webhook targets it (the crisis scan is dead until this runs).
- Prove it live per the **mento-crisis-webhook** skill before trusting it.

### 9. Backups

```bash
sudo mkdir -p /opt/mento-backups && sudo chown mento-ops:mento-ops /opt/mento-backups
crontab -e
# add (NOT /var/log — mento-ops can't write there; the script's own output dir works):
0 3 * * * /opt/mento/deploy/backup-postgres.sh >> /opt/mento-backups/backup.log 2>&1
```

`deploy/backup-postgres.sh` dumps + gzips nightly, keeps 14 days locally. Wire the
commented `rclone` line to an off-box target (Backblaze B2, S3, etc.) before trusting
this as a real backup — a local-only dump doesn't survive the VPS dying.

### 10. Uptime monitor (launch gate — same as the DO path)

Point an external monitor (UptimeRobot / Better Stack) at
`https://api.agentin.chat/api/v1/health/crisis`, alerting on 503. This is the
signal that the crisis-scan pipeline itself died (Stream configured but no webhook
in 30 min, or Redis down) — not optional before real users touch this.

A second check on `https://api.agentin.chat/api/v1/health/ready` (503 = Postgres
unreachable from the API) tells "the API process is up but nothing works" apart from
"the box is down". Support tip: every API response carries `X-Request-ID`, and every
log line for that request carries the same value as `rid=` —
`docker logs mento-api-prod 2>&1 | grep rid=<id>`.

### 11. The web build — app host, admin host, legacy redirects

One Expo web export (`apps/mobile`, `web.output: "single"`) is served by **two**
Nginx sites from the same directory (`/opt/mento-console/current`):

| Host (from `deploy/domains.env`) | Serves |
|---|---|
| `APP_HOST` (`app.<root>`) | the whole app — landing, journey, member + mentor sides, `/apply`; `/admin` is 404 here |
| `ADMIN_HOST` (`admin.<root>`) | only `/admin` (+ static assets); `/` → `/admin`; everything else 404 |
| each of `LEGACY_HOSTS` (`console.<root>`) | 301 → the app host (`/admin*` → the admin host), path + query kept |

Founder ruling 2026-09-19: the member app is public on the web. What protects a
member is server-side (age gate, crisis scan on the Stream webhook, rate limits).
History: session 28 allow-listed only `/admin`, `/listener`, `/apply` on a single
`console.` host; `f1d5483` is the last commit with that lockdown if it ever needs
restoring.

**Build locally, not on the VPS** (1–2 GB RAM can't run Expo/Metro):

```bash
# One-time: create apps/mobile/.env.production (gitignored) with:
#   EXPO_PUBLIC_API_URL=https://<API_HOST>/api/v1
#   EXPO_PUBLIC_STREAM_API_KEY=<the PROD Stream app's publishable key>
./deploy/deploy-web.sh        # builds, uploads, swaps atomically, checks both hosts
```

**One-time per host — cert first, then the site** (the rendered conf names the
cert paths, so `nginx -t` fails until the cert exists):

```bash
. deploy/domains.env
ssh "$VPS_SSH" "sudo certbot certonly --nginx -d $APP_HOST --non-interactive --agree-tos -m <you>@example.com"
./deploy/render-nginx.sh app | ssh "$VPS_SSH" "cat > /tmp/mento-app.conf"
ssh "$VPS_SSH" 'sudo cp /tmp/mento-app.conf /etc/nginx/sites-available/ \
  && sudo ln -sf /etc/nginx/sites-available/mento-app.conf /etc/nginx/sites-enabled/ \
  && sudo nginx -t && sudo systemctl reload nginx'
# same for:  render-nginx.sh admin → mento-admin.conf   (cert: $ADMIN_HOST)
#            render-nginx.sh legacy <host> → mento-legacy-<host>.conf (cert already exists for console.)
```

**Changing a site later:** edit the template, run `./deploy/test-nginx.sh` (renders
every site into a throwaway `nginx:1.22` and asserts the host map), re-render,
copy, `nginx -t`, reload. Back up the installed file first; never hand-edit it.

**Auto-deploy on push (`.github/workflows/console-deploy.yml`, not yet activated):**
runs `deploy-web.sh` on pushes to `master` touching `apps/mobile/**`. Needs two repo
secrets before it runs (deliberately not created by an agent — live credentials):
`MOBILE_ENV_PRODUCTION` (full contents of `apps/mobile/.env.production`) and
`CONSOLE_DEPLOY_SSH_KEY` (a **dedicated** ed25519 private key whose `.pub` is in
`~mento-ops/.ssh/authorized_keys`). Until both exist the workflow fails loudly.

### 12. Changing the domain

Everything that names a host reads `deploy/domains.env`, so a move is:

1. A records for `app`, `api`, `admin` (and the apex) on the new root → the VPS IP.
2. Edit `ROOT_DOMAIN` in `deploy/domains.env`; append the old hosts to `LEGACY_HOSTS`. Run `./deploy/test-nginx.sh`.
3. `certbot certonly --nginx -d <host>` for each new host; re-render + install the app, admin and legacy sites (and `mento-api.conf` from its template) → `nginx -t` → reload.
4. API env: `APP_BASE_URL`, `ADMIN_BASE_URL`, `CORS_ORIGINS` → `./deploy/deploy.sh`.
5. `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.production` → `./deploy/deploy-web.sh` + an OTA for the APK.
6. `python -m scripts.configure_stream` with the new API URL — **the crisis-scan webhook is dead until this runs**; prove it per the `mento-crisis-webhook` skill.

Old hosts keep redirecting for as long as their DNS records and certs live.

---

## Ongoing deploys (Test → Prod)

1. Do the work locally against Test, verify per `mento-verify` (pytest, `alembic
   check`, `tsc --noEmit`, e2e for touched flows).
2. Ship: `bash scripts/lanes/ship.sh "what changed"` (gate → push → box checkout to
   that exact commit → `deploy.sh --backup <sha>` → web → OTA). By hand:
   `ssh mento-ops@<vps-ip> 'cd /opt/mento && git fetch -q origin && git reset -q --hard <sha> && ./deploy/deploy.sh --backup <sha>'`

What `deploy.sh` does (WS1 T1.9; proof: `bash deploy/test-deploy.sh`):

1. checks out the commit and builds `mento-api:<sha12>` (skipped if it exists);
2. runs `alembic upgrade head` in a **one-off container** on the new image. The
   serving container no longer migrates on boot. Each migration waits at most **3 s**
   for a lock (`migrations/env.py`), so it can't queue live traffic behind it. **If
   the migration fails, the deploy stops and the old container keeps serving;**
3. swaps. On today's stack the one `api` container is recreated (a few seconds of
   502s from Nginx — as before) and, if it never turns healthy on
   `/api/v1/health/ready`, is **put back on the previous image tag** automatically.
   On the Balanced stack (`MENTO_STACK=balanced`, after the server move) it is a
   blue/green swap through Caddy with no failed requests (`deploy/bluegreen.sh`).

One deploy at a time (a lock refuses a second). State (live tag, previous tag, live
colour) lives in `~/.local/state/mento/` on the box. Env: the SOPS file when it
exists (see "Secrets"), otherwise `services/api/.env`.

**Migrations must be backward-compatible with the code still serving** (add a
column, backfill, only then use it; drop in a later release). Blue/green and the
automatic rollback both run the previous image against the new schema.

**If the change touched anything in `apps/mobile`** (the web build serves the
whole app), also run `./deploy/deploy-web.sh` (locally — see step 11) — the two
deploys are independent; `deploy.sh` only ships the API.

### Rollback

```bash
ssh mento-ops@<vps-ip> 'cd /opt/mento && ./deploy/deploy.sh --rollback'
```

Puts the previous image back (no migrations run; the schema stays). Rolling back
past a migration that already ran requires a new forward migration or a restore
from `deploy/backup-postgres.sh`'s dump — forward-only migrations (CLAUDE.md) mean
rollback is not free; plan destructive migrations accordingly.

### CI deploys (`.github/workflows/api-deploy.yml`) — off until you turn them on

After **API CI** passes on master, the workflow can SSH to the box with a deploy-only
key that can run nothing but `deploy.sh --from-ssh` (backup, then deploy that exact
commit). It is inert until all of this exists:

```bash
# On the laptop: a key used for nothing else.
ssh-keygen -t ed25519 -N '' -C mento-ci-deploy -f mento-ci-deploy
# On the box, as mento-ops: append ONE line to ~/.ssh/authorized_keys —
#   restrict,command="/opt/mento/deploy/deploy.sh --from-ssh" <contents of mento-ci-deploy.pub>
# `restrict` = no shell, no pty, no forwarding; the command ignores what the client asks
# for except "deploy <40-hex sha>", and that sha must be on origin/master.
# The box's host key line, for pinning (run from the laptop, check it against the box):
ssh-keyscan -t ed25519 <vps-ip>
```

GitHub → Settings → Secrets and variables → Actions: secrets `API_DEPLOY_SSH_KEY`
(private key file contents) and `API_DEPLOY_KNOWN_HOSTS` (the keyscan line); then the
variable `API_AUTO_DEPLOY=true` to deploy after every green API CI on master. Manual
runs (Actions → API Deploy → Run workflow) work without the variable. Optional:
Settings → Environments → `production` → required reviewers, to approve each deploy.
CI deploys do not ship the web build or the OTA — `ship.sh` still does.
**Turn CI on only after one `ship.sh` run** has put this version of `deploy.sh` on the
box: the forced command runs the `deploy.sh` already on disk, and the one before
WS1 T1.9 knows nothing about `--from-ssh`.

### Rotation

Rotating `STREAM_API_SECRET` invalidates webhook signatures — re-run
`scripts.configure_stream` immediately after.

---

## The Balanced stack (Compose + Caddy) — staged, not live

**Status:** committed (WS1 T1.1–T1.4, T1.7) and proven locally; prod still runs
`deploy/docker-compose.prod.yml` behind host Nginx until the server move (T1.10).

- `deploy/caddy/Caddyfile` — one edge config for local and prod, hosts from the
  environment (`deploy/domains.env` in prod). Proof: `bash deploy/test-caddy.sh`
  (same host map as `test-nginx.sh`, plus a WebSocket upgrade through `api.`).
- `deploy/compose.base.yml` + `compose.local.yml` / `compose.prod.yml` — see the
  header of `compose.base.yml`. Parity proof: `bash deploy/test-parity.sh`.

### Local hostnames

The local stack serves `app.mento.localhost`, `api.mento.localhost` and
`admin.mento.localhost`. Chrome, Firefox and systemd-resolved already send
`*.localhost` to 127.0.0.1; Windows tools (curl, PowerShell, Node) need three lines
in `C:\Windows\System32\drivers\etc\hosts` (edit as Administrator):

```
127.0.0.1 app.mento.localhost
127.0.0.1 api.mento.localhost
127.0.0.1 admin.mento.localhost
```

By default the local Caddy uses its own internal CA (`CADDY_TLS=internal`): works
with no setup, but browsers warn. For browser-trusted certificates, once:

```powershell
mkcert -install
mkdir deploy/caddy/certs
mkcert -cert-file deploy/caddy/certs/cert.pem -key-file deploy/caddy/certs/key.pem `
  mento.localhost app.mento.localhost api.mento.localhost admin.mento.localhost
```

then start the stack with `CADDY_TLS=mkcert` (the `.pem` files are gitignored).

### Error tracker (GlitchTip)

T1.7. MIT-licensed, self-hosted, Sentry-protocol compatible — `SENTRY_DSN` /
`EXPO_PUBLIC_SENTRY_DSN` just point at it, no code change either side. Its own
database inside the existing Postgres (`glitchtip`, not `mento`) and its own
Valkey db index (1 — the API uses 0). `SERVER_ROLE=all_in_one` runs web, worker
and migrations in one container; migrations run automatically on boot.

Not on Caddy — it's a staff tool, not a public surface, and `deploy/domains.env`
stays the only place a public hostname is written. Reachable over an SSH tunnel
only (`ports: 127.0.0.1:8010:8000` in `compose.prod.yml`).

**One-time setup**, after `MENTO_STACK=balanced` first comes up:

```bash
# Once: a real secret, not the placeholder below.
openssl rand -hex 32   # → GLITCHTIP_SECRET_KEY in the prod env file

# Once: create the database (Postgres only auto-creates the one named by
# POSTGRES_DB). Safe to re-run — checks before creating.
docker compose --profile tools run --rm glitchtip-init-db

docker compose up -d glitchtip
```

Web signup is closed from the start (`ENABLE_USER_REGISTRATION: "False"` in
`compose.prod.yml` — no window where it's briefly open to the internet). Create
the one account from the shell instead:

```bash
docker exec -it mento-glitchtip python manage.py createsuperuser
```

**Everyday access** (never expose the port publicly):

```bash
ssh -L 8010:localhost:8010 <vps-ssh-alias>
# then open http://localhost:8010 and log in with the account above
```

Create an organization and a project from the UI; the project's DSN goes into
`SENTRY_DSN` (API) and `EXPO_PUBLIC_SENTRY_DSN` (mobile).

Verified (session 41): a crafted event with a request body, query string,
cookies and an `Authorization` header — sent through the app's own
`observability.py` `before_send` hook — arrives with all four stripped (checked
byte-for-byte against the raw stored event, not just the fields we expected to
check); a plain unhandled exception arrives with its type and message intact
(by design — only *request* data is stripped, not the error itself).

---

## Secrets (SOPS + age)

**Status:** tooling committed (WS1 T1.8); **not yet adopted on prod.** Until
`deploy/secrets/prod.env.sops.yaml` exists, the box keeps reading the plaintext
`services/api/.env` exactly as before. The steps below need the founder: only the
founder creates keys and holds real secrets.

**What it is.** The production env file is committed to git **encrypted**
(`deploy/secrets/prod.env.sops.yaml`). At deploy time `deploy/decrypt-env.sh`
decrypts it into the deploy user's tmpfs runtime dir (`/run/user/<uid>/mento/api.env`,
mode 600, wiped at reboot) and compose reads that as `env_file`. Plaintext secrets
never sit on the server's disk and never go through GitHub.

### Key custody

| Key | Where the private half lives | Who can decrypt with it |
|---|---|---|
| **Founder key** | Founder's laptop (`~/.config/sops/age/keys.txt`) **plus** a password-manager entry **plus** a printed paper copy in a safe place. Never on the server, never in GitHub, never in chat. | The founder, to edit secrets or recover. |
| **Server key** | Generated **on** the prod box as `mento-ops`, at `~/.config/sops/age/keys.txt` (mode 600). Never copied off the box. | The box, at deploy time. |

Every secret is encrypted to **both** public keys (`.sops.yaml`), so losing either
one private key loses nothing. GitHub Actions never gets an age key: CI only SSHes
in; the box decrypts.

### One-time setup

```bash
# 1. Tools (laptop and box). age from the distro; sops as a pinned release binary.
sudo apt-get install -y age
SOPS_V=3.10.2
curl -fsSLo /tmp/sops "https://github.com/getsops/sops/releases/download/v${SOPS_V}/sops-v${SOPS_V}.linux.amd64"
curl -fsSLo /tmp/sops.sums "https://github.com/getsops/sops/releases/download/v${SOPS_V}/sops-v${SOPS_V}.checksums.txt"
(cd /tmp && grep " sops-v${SOPS_V}.linux.amd64\$" sops.sums | sed "s| sops-v${SOPS_V}.linux.amd64| sops|" | sha256sum -c -)
sudo install -m 755 /tmp/sops /usr/local/bin/sops

# 2. Founder key (on the laptop). Back up the file it writes, then note the public key.
mkdir -p ~/.config/sops/age && age-keygen -o ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt        # → age1… (founder public key)

# 3. Server key (on the box, as mento-ops).
mkdir -p ~/.config/sops/age && age-keygen -o ~/.config/sops/age/keys.txt && chmod 600 ~/.config/sops/age/keys.txt
age-keygen -y ~/.config/sops/age/keys.txt        # → age1… (server public key)

# 4. Laptop, repo root: put both PUBLIC keys into .sops.yaml (replace the two
#    REPLACE_WITH_… placeholders), then encrypt the current prod .env. The copy of
#    the prod .env comes off the box over ssh, straight into sops — never saved.
ssh mento-ops@<box> 'cat /opt/mento/services/api/.env' \
  | sops --encrypt --filename-override deploy/secrets/prod.env.sops.yaml \
         --input-type dotenv --output-type yaml /dev/stdin > deploy/secrets/prod.env.sops.yaml
git add .sops.yaml deploy/secrets/prod.env.sops.yaml && git commit -m "chore(deploy): encrypted prod env"

# 5. Box, after pulling: prove the box can open it.
./deploy/decrypt-env.sh && echo decrypted OK
```

`--filename-override` matters: sops picks the recipients by matching the rule's
`path_regex` against the file name it is given, and the input here is stdin.

### Everyday use

- **Edit a secret:** `sops deploy/secrets/prod.env.sops.yaml` on the laptop (opens
  `$EDITOR` on the decrypted text, re-encrypts on save). Commit, then deploy.
- **No `$` in any value.** Compose rewrites `$` inside `env_file` values (`x$HOMEy`
  arrives as `x`), so `decrypt-env.sh` refuses such a file and names the key. Generate
  secrets from `[A-Za-z0-9_-]` (e.g. `openssl rand -hex 32`).
- **Prove the tooling:** `bash deploy/test-secrets.sh` (throwaway keys, needs Docker).

### Rotation and loss

- **A secret leaked:** change it at its source (Stream, DB password, …), `sops` edit,
  commit, deploy.
- **Server key lost** (box rebuilt): new server key on the new box, replace its public
  key in `.sops.yaml`, then on the laptop `sops updatekeys deploy/secrets/prod.env.sops.yaml`
  (re-wraps the data key for the new recipient set), commit.
- **Founder key lost:** restore it from the password manager or paper copy. If every
  copy is gone, the server key still decrypts: have the box decrypt, make a new founder
  key, `updatekeys` from a machine holding the server key. Never leave it at one key.
- **A private key leaked:** treat every secret in the file as leaked. Rotate each at its
  source, make a new key pair for the leaked holder, `updatekeys`, commit. Removing a
  recipient does not un-leak old ciphertext already in git history.

---

## What's still missing (flag before real users depend on this)

- ~~Admin dashboard / listener console have no production web build~~ **Resolved
  session 28**, reshaped session 34 — the web build is served from the app host
  (whole app) and the admin host (`/admin` only); see step 11. Redeploy with
  `./deploy/deploy-web.sh`. Still manual/separate from `deploy.sh` — the CI
  workflow exists but is not activated (needs two repo secrets).
- **Self-hosted OTA server** (for `expo-updates` shake-to-update, per
  `docs/ANDROID_BUILD.md`) is a natural fit to run on this same VPS
  (`updates.agentin.chat`) — not stood up yet; `app.json`'s `updates.url` block
  is the one remaining config once it exists.
- **No off-box backup destination configured** — the `rclone` line in
  `backup-postgres.sh` is a placeholder. A VPS disk failure currently means data
  loss beyond the 14-day local retention window.
