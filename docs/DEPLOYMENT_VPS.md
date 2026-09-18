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

Set at minimum: `ENV=prod`, distinct random `JWT_SECRET` and `ADMIN_JWT_SECRET`,
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
2. Commit, push to `master` on the GitHub remote (`origin` = `github.com/trendywink247-afk/mento-app`, private).
3. `ssh mento-ops@<vps-ip> 'cd /opt/mento && ./deploy/deploy.sh'`

`deploy.sh` hard-resets the VPS checkout to `origin/master`, rebuilds the API image,
and brings the stack up — the container entrypoint runs `alembic upgrade head`
automatically before serving, and refuses to serve if migrations fail. If a
migration is destructive or backward-incompatible, run
`./deploy/backup-postgres.sh` manually right before deploying that one.

**If the change touched anything in `apps/mobile`** (the web build serves the
whole app), also run `./deploy/deploy-web.sh` (locally — see step 11) — the two
deploys are independent; `deploy.sh` only ships the API.

### Rollback

```bash
git log --oneline -5          # find the last-good commit
git reset --hard <sha>
docker compose -f deploy/docker-compose.prod.yml up -d --build
```

Rolling back past a migration that already ran requires an Alembic downgrade or a
restore from `deploy/backup-postgres.sh`'s dump — forward-only migrations
(CLAUDE.md) mean rollback is not free; plan destructive migrations accordingly.

### Rotation

Rotating `STREAM_API_SECRET` invalidates webhook signatures — re-run
`scripts.configure_stream` immediately after.

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
