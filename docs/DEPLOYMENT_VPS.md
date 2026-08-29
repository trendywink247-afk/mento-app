# Mento — Test/Prod on a self-managed VPS (Hostinger)

> Companion to `docs/DEPLOYMENT.md` (the DigitalOcean App Platform path). This doc
> is for a **raw VPS** (Hostinger, or any Ubuntu box) instead of a managed PaaS —
> the difference is Postgres/Redis are self-managed containers here, not a
> managed database, and Nginx + certbot replace DO's built-in load balancer/TLS.

## The two environments

| | Test | Prod |
|---|---|---|
| Where | This laptop | Hostinger VPS |
| Postgres/Redis | `docker compose up -d` (services/api/docker-compose.yml) | `deploy/docker-compose.prod.yml`, self-managed containers |
| API | `uvicorn app.main:app --port 8000` (reload-friendly, foreground) | Dockerized, `restart: always`, behind Nginx+TLS |
| Mobile | `npx expo start --web --port 8081` (Metro dev server) | N/A — mobile ships as an APK; web stays dev/test only (CLAUDE.md) |
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

### 1. Order the VPS

Resource target for this stack at pilot scale (FastAPI + Postgres + Redis + Nginx,
a few hundred concurrent users): **2 vCPU / 4 GB RAM / 80 GB NVMe**, matched against
whichever current Hostinger VPS tier meets that (their plan names/specs change —
match the numbers, not a label). **Ubuntu 24.04 LTS** — best Docker support, longest
support window, most documented. You'll also need a **domain** pointed at the VPS's
IP (an A record) — buy/use one via Hostinger or any registrar; this doc uses
`api.yourdomain.com` as a placeholder throughout.

### 2. Base server hardening

SSH in as root once, then:

```bash
adduser mento-ops
usermod -aG sudo mento-ops
# copy your SSH public key into /home/mento-ops/.ssh/authorized_keys, then:
ufw allow OpenSSH
ufw allow 80,443/tcp
ufw enable
```

From here on, SSH in as `mento-ops`, not root.

### 3. Install Docker, Nginx, certbot

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker mento-ops   # log out/in after this
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 4. Clone the repo

Requires the private GitHub remote (see below) to be set up first.

```bash
sudo mkdir -p /opt/mento && sudo chown mento-ops:mento-ops /opt/mento
git clone git@github.com:<you>/mento.git /opt/mento
cd /opt/mento
```

### 5. Fill in prod secrets

```bash
cp services/api/.env.example services/api/.env
nano services/api/.env
```

Set at minimum: `ENV=prod`, distinct random `JWT_SECRET` and `ADMIN_JWT_SECRET`,
`POSTGRES_PASSWORD` (new value — this is the VPS path, `DATABASE_URL` itself is
overridden by `deploy/docker-compose.prod.yml`), `CORS_ORIGINS`, `CONSOLE_BASE_URL`,
`STREAM_API_KEY`/`STREAM_API_SECRET`, `TRUSTED_PROXY_HOPS=1` (single Nginx hop).
Leave Razorpay/PostHog/Sentry/Gemini blank until those are ready — every one of
those integrations ships dark by design (CLAUDE.md).

### 6. First deploy

```bash
chmod +x deploy/deploy.sh deploy/backup-postgres.sh
./deploy/deploy.sh
curl http://127.0.0.1:8000/api/v1/health   # expect {"status":"ok"}
```

### 7. Nginx + TLS

```bash
sed "s/API_DOMAIN/api.yourdomain.com/g" deploy/nginx/mento-api.conf.template \
  | sudo tee /etc/nginx/sites-available/mento-api.conf
sudo ln -s /etc/nginx/sites-available/mento-api.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.yourdomain.com   # provisions TLS, rewrites the server block, sets up auto-renewal
```

Verify from OUTSIDE the box: `curl https://api.yourdomain.com/api/v1/health`.

### 8. Point the mobile app + Stream at prod

- Mobile `.env` / build config: `EXPO_PUBLIC_API_URL=https://api.yourdomain.com/api/v1`.
- Re-run `python -m scripts.configure_stream` with the prod URL so Stream's
  before-send webhook targets it (the crisis scan is dead until this runs).
- Prove it live per the **mento-crisis-webhook** skill before trusting it.

### 9. Backups

```bash
crontab -e
# add:
0 3 * * * /opt/mento/deploy/backup-postgres.sh >> /var/log/mento-backup.log 2>&1
```

`deploy/backup-postgres.sh` dumps + gzips nightly, keeps 14 days locally. Wire the
commented `rclone` line to an off-box target (Backblaze B2, S3, etc.) before trusting
this as a real backup — a local-only dump doesn't survive the VPS dying.

### 10. Uptime monitor (launch gate — same as the DO path)

Point an external monitor (UptimeRobot / Better Stack) at
`https://api.yourdomain.com/api/v1/health/crisis`, alerting on 503. This is the
signal that the crisis-scan pipeline itself died (Stream configured but no webhook
in 30 min, or Redis down) — not optional before real users touch this.

---

## Ongoing deploys (Test → Prod)

1. Do the work locally against Test, verify per `mento-verify` (pytest, `alembic
   check`, `tsc --noEmit`, e2e for touched flows).
2. Commit, push to `main` on the GitHub remote.
3. `ssh mento-ops@<vps-ip> 'cd /opt/mento && ./deploy/deploy.sh'`

`deploy.sh` hard-resets the VPS checkout to `origin/main`, rebuilds the API image,
and brings the stack up — the container entrypoint runs `alembic upgrade head`
automatically before serving, and refuses to serve if migrations fail. If a
migration is destructive or backward-incompatible, run
`./deploy/backup-postgres.sh` manually right before deploying that one.

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

- **Admin dashboard / listener console have no production web build yet.** Today
  they only run via `expo start --web` (explicitly a dev/test surface per
  CLAUDE.md's stack table). For safety staff / listeners to use them against prod,
  someone needs to add an `expo export --platform web` step and serve the static
  output via Nginx (a new `location` block, likely `console.yourdomain.com`) —
  not yet built. Scope this before onboarding real listeners against prod.
- **Self-hosted OTA server** (for `expo-updates` shake-to-update, per
  `docs/ANDROID_BUILD.md`) is a natural fit to run on this same VPS
  (`updates.yourdomain.com`) — not stood up yet; `app.json`'s `updates.url` block
  is the one remaining config once it exists.
- **No off-box backup destination configured** — the `rclone` line in
  `backup-postgres.sh` is a placeholder. A VPS disk failure currently means data
  loss beyond the 14-day local retention window.
