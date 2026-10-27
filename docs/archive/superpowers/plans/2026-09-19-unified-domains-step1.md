# Unified Domains — Step 1 (hosts + dynamic config) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the one web app at `app.<root>`, the staff dashboard alone at `admin.<root>`, turn `console.<root>` into redirects, and make every hostname come from one file so the root domain can change without touching code.

**Architecture:** One `deploy/domains.env` is the only place a hostname is written. Nginx sites are rendered from three small templates by `deploy/render-nginx.sh` (one site per file, like `mento-api.conf`). The API gains `APP_BASE_URL` / `ADMIN_BASE_URL` with the old `CONSOLE_BASE_URL` as a fallback, and all minted links go through one `app/services/links.py`. No app (TypeScript) code changes — routes are untouched in this step; link *paths* stay `/listener#token=` and `/admin#token=` (they change in routes-spec step 3).

**Tech Stack:** Nginx 1.22 (Debian 12 VPS), certbot, bash, Docker (local Nginx proof), FastAPI + pydantic-settings, pytest.

**Spec:** `docs/superpowers/specs/2026-09-19-unified-domains-routes-design.md` §3, §5 step 1, §7.

---

## Ground rules for this plan (read first)

- **Work only in this worktree** (`.claude/worktrees/unified-domains`, branch `worktree-unified-domains`). Another Claude session (`mento-1e`) is live in the main checkout on `feat/companions-dog-cat-capybara`. Never `cd` to the main checkout to run git, never touch the shared stash.
- **Never run pytest against the shared dev database** — `db_session` TRUNCATEs listeners/users and would break the other session's e2e runs. Task 0 creates an isolated database; every pytest command below sets `DATABASE_URL` to it.
- Python interpreter (the main checkout's venv, used read-only): `PY="C:/Users/khana/Desktop/Mento/services/api/.venv/Scripts/python.exe"`. Run API commands from `services/api/` **inside this worktree**.
- **Prod changes (Task 7) are operator-gated:** each sub-step needs the founder's explicit go-ahead in the conversation before it runs; every Nginx change is backup → `nginx -t` → reload, restore on failure.
- `deploy.sh` on the VPS does `git reset --hard origin/master` — API **code** reaches prod only after this branch is merged to `master` and pushed. Task 7 is ordered so nothing in it needs that.

## File structure

| File | Responsibility |
|---|---|
| `deploy/domains.env` (new) | the only place hostnames + the SSH target are written |
| `deploy/render-nginx.sh` (new) | `domains.env` + a template → a site conf on stdout |
| `deploy/nginx/mento-app.conf.template` (new) | the app host: SPA fallback, `/admin` 404, strict assets |
| `deploy/nginx/mento-admin.conf.template` (new) | the admin host: only `/admin` + assets |
| `deploy/nginx/mento-redirect.conf.template` (new) | a host that only redirects (legacy `console.`, later the apex) |
| `deploy/test-nginx.sh` (new) | renders every site, runs them in `nginx:1.22`, asserts the host map |
| `deploy/nginx/mento-console.conf` (delete) | replaced by the templates |
| `deploy/deploy-web.sh` (renamed from `deploy-console.sh`) | build + ship the web build; hosts from `domains.env` |
| `deploy/deploy-console.sh` | one-line wrapper → `deploy-web.sh` (removed in routes-spec step 4) |
| `.github/workflows/console-deploy.yml` | reads `domains.env`; calls `deploy-web.sh` |
| `services/api/app/config.py` | `app_base_url`, `admin_base_url`, resolved fallbacks, CORS derivation |
| `services/api/app/services/links.py` (new) | the two link builders |
| `services/api/app/routers/admin_console.py`, `listener_applications.py` | call `links.*` instead of formatting URLs |
| `services/api/tests/test_base_urls.py` (new) | settings fallbacks + link builders (pure, no DB) |
| `docs/DEPLOYMENT_VPS.md`, `CLAUDE.md`, `services/api/.env.example`, `PROGRESS.md` | reality |

---

### Task 0: Isolated test database

**Files:** none (local infra only).

- [ ] **Step 1: Confirm the dev Postgres container is up**

Run: `docker ps --format "{{.Names}}" | grep -x mento-postgres`
Expected: `mento-postgres`. If missing, stop and report — do **not** run `docker compose up` from this worktree (it would fight the other session's stack).

- [ ] **Step 2: Create the database (idempotent)**

```bash
docker exec mento-postgres psql -U mento -d mento -tc "SELECT 1 FROM pg_database WHERE datname='mento_wt'" | grep -q 1 \
  || docker exec mento-postgres createdb -U mento mento_wt
```

- [ ] **Step 3: Prove the suite runs against it and not the shared DB**

```bash
cd services/api
PY="C:/Users/khana/Desktop/Mento/services/api/.venv/Scripts/python.exe"
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest tests/test_cors_config.py -q
```

Expected: `10 passed` (the session-scoped `_schema` fixture migrates `mento_wt` to head on first use).

Then prove the shared DB was not touched:

```bash
docker exec mento-postgres psql -U mento -d mento -tc "SELECT count(*) FROM listener_profiles"
```

Expected: a non-zero count (the other session's seeded listeners are still there). If it is `0`, stop and tell the founder — someone truncated the shared DB.

---

### Task 1: `domains.env`, the renderer, and the failing Nginx proof

**Files:**
- Create: `deploy/domains.env`
- Create: `deploy/render-nginx.sh`
- Create: `deploy/test-nginx.sh`

- [ ] **Step 1: Write `deploy/domains.env`**

```bash
# The ONLY place a Mento hostname is written. Sourced by deploy/render-nginx.sh,
# deploy/deploy-web.sh, deploy/test-nginx.sh and the console-deploy workflow.
# Changing the root domain: docs/DEPLOYMENT_VPS.md → "Changing the domain".
ROOT_DOMAIN=agentin.chat
APP_HOST=app.${ROOT_DOMAIN}
API_HOST=api.${ROOT_DOMAIN}
ADMIN_HOST=admin.${ROOT_DOMAIN}
# Space-separated hosts that now only redirect (each keeps its own cert).
LEGACY_HOSTS="console.${ROOT_DOMAIN}"
VPS_SSH=mento-ops@87.232.72.79
```

- [ ] **Step 2: Write `deploy/render-nginx.sh`**

```bash
#!/usr/bin/env bash
# Render one Nginx site from its template + deploy/domains.env, to stdout.
#   deploy/render-nginx.sh app                > mento-app.conf
#   deploy/render-nginx.sh admin              > mento-admin.conf
#   deploy/render-nginx.sh legacy <host>      > mento-legacy-<host>.conf   (301s)
#   deploy/render-nginx.sh apex               > mento-apex.conf            (302s)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck source=domains.env
. "$HERE/domains.env"
set +a

kind="${1:?usage: render-nginx.sh app|admin|legacy <host>|apex}"
case "$kind" in
    app)    tpl=mento-app.conf.template;      site="$APP_HOST";   code=301 ;;
    admin)  tpl=mento-admin.conf.template;    site="$ADMIN_HOST"; code=301 ;;
    legacy) tpl=mento-redirect.conf.template; site="${2:?legacy needs a host}"; code=301 ;;
    apex)   tpl=mento-redirect.conf.template; site="$ROOT_DOMAIN"; code=302 ;;
    *) echo "render-nginx: unknown kind '$kind'" >&2; exit 2 ;;
esac

# SITE_HOST first: APP_HOST/ADMIN_HOST are distinct tokens, never substrings of it.
sed -e "s/SITE_HOST/${site}/g" \
    -e "s/APP_HOST/${APP_HOST}/g" \
    -e "s/ADMIN_HOST/${ADMIN_HOST}/g" \
    -e "s/REDIRECT_CODE/${code}/g" \
    "$HERE/nginx/$tpl"
```

Run: `chmod +x deploy/render-nginx.sh`

- [ ] **Step 3: Write `deploy/test-nginx.sh`** (the proof; it must fail now — no templates yet)

```bash
#!/usr/bin/env bash
# Proof for the rendered Nginx sites: run them in a throwaway nginx:1.22 (same
# line as the VPS) with the TLS lines stripped — location logic is byte-identical —
# and assert the host map of spec 2026-09-19-unified-domains §3.1 row by row.
# Needs Docker. Exit 0 = every assertion held.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a; . "$HERE/domains.env"; set +a
NAME=mento-nginx-proof
PORT=18080
TMP="$(mktemp -d)"
cleanup() { docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

mkdir -p "$TMP/conf" "$TMP/root/_expo" "$TMP/root/assets"
echo "SPA-INDEX" > "$TMP/root/index.html"
echo "js" > "$TMP/root/_expo/app.js"

strip_tls() {
    sed -e "s/listen 443 ssl;/listen 8080;/" \
        -e "/ssl_certificate/d" -e "/ssl_dhparam/d" -e "/options-ssl-nginx/d" \
        -e "s#root /opt/mento-console/current;#root /usr/share/nginx/html;#"
}
"$HERE/render-nginx.sh" app   | strip_tls > "$TMP/conf/app.conf"
"$HERE/render-nginx.sh" admin | strip_tls > "$TMP/conf/admin.conf"
"$HERE/render-nginx.sh" apex  | strip_tls > "$TMP/conf/apex.conf"
for h in $LEGACY_HOSTS; do "$HERE/render-nginx.sh" legacy "$h" | strip_tls > "$TMP/conf/legacy-$h.conf"; done

# Git Bash needs a Windows path for the bind mount; elsewhere pwd -W does not exist.
WIN="$(cd "$TMP" && (pwd -W 2>/dev/null || pwd))"
docker rm -f "$NAME" >/dev/null 2>&1 || true
MSYS_NO_PATHCONV=1 docker run -d --name "$NAME" -p "$PORT:8080" \
    -v "$WIN/conf:/etc/nginx/conf.d:ro" -v "$WIN/root:/usr/share/nginx/html:ro" nginx:1.22 >/dev/null
docker exec "$NAME" nginx -t
# Wait for the listener without a sleep loop: curl retries refused connections itself.
curl -s -o /dev/null --retry 20 --retry-delay 1 --retry-connrefused     -H "Host: $APP_HOST" "http://localhost:$PORT/"

fails=0
# expect <host> <path> <code> [<Location suffix>]
expect() {
    local host=$1 path=$2 want=$3 loc=${4:-}
    local out code got
    out="$(curl -s -o /dev/null -m 5 -H "Host: $host" -w "%{http_code} %{redirect_url}" "http://localhost:$PORT$path")"
    code="${out%% *}"; got="${out#* }"
    if [ "$code" != "$want" ]; then echo "FAIL $host$path: code $code, want $want"; fails=$((fails+1)); return; fi
    if [ -n "$loc" ] && [ "${got%"$loc"}" = "$got" ]; then echo "FAIL $host$path: Location '$got', want …$loc"; fails=$((fails+1)); return; fi
    echo "ok   $host$path -> $code ${loc:+($loc)}"
}

# app host: the whole app, but never /admin, and assets stay strict
for p in / /onboarding /chat/abc /apply /signin /mentoring; do expect "$APP_HOST" "$p" 200; done
expect "$APP_HOST" /admin 404
expect "$APP_HOST" /admin/anything 404
expect "$APP_HOST" /_expo/app.js 200
expect "$APP_HOST" /_expo/missing.js 404
expect "$APP_HOST" /assets/missing.png 404

# admin host: only /admin (+ assets); the bare host lands on the dashboard
expect "$ADMIN_HOST" /admin 200
expect "$ADMIN_HOST" / 302 /admin
expect "$ADMIN_HOST" /onboarding 404
expect "$ADMIN_HOST" /chat/abc 404
expect "$ADMIN_HOST" /_expo/app.js 200

# legacy hosts: permanent redirects, path + query kept, /admin goes to the admin host
for h in $LEGACY_HOSTS; do
    expect "$h" / 301 "https://$APP_HOST/"
    expect "$h" /listener 301 "https://$APP_HOST/listener"
    expect "$h" "/apply?x=1" 301 "https://$APP_HOST/apply?x=1"
    expect "$h" /admin 301 "https://$ADMIN_HOST/admin"
done

# apex: temporary redirect (a marketing page may live here later)
expect "$ROOT_DOMAIN" / 302 "https://$APP_HOST/"

[ "$fails" -eq 0 ] && echo "nginx proof: all assertions held" || { echo "nginx proof: $fails failure(s)"; exit 1; }
```

Run: `chmod +x deploy/test-nginx.sh`

- [ ] **Step 4: Run it — verify it fails for the right reason**

Run: `./deploy/test-nginx.sh`
Expected: non-zero exit, `sed: can't read …/nginx/mento-app.conf.template: No such file or directory`.

- [ ] **Step 5: Commit**

```bash
git add deploy/domains.env deploy/render-nginx.sh deploy/test-nginx.sh
git commit -m "feat(deploy): domains.env + nginx renderer + host-map proof (failing: no templates yet)"
```

---

### Task 2: The three site templates

**Files:**
- Create: `deploy/nginx/mento-app.conf.template`
- Create: `deploy/nginx/mento-admin.conf.template`
- Create: `deploy/nginx/mento-redirect.conf.template`
- Delete: `deploy/nginx/mento-console.conf`

- [ ] **Step 1: `deploy/nginx/mento-app.conf.template`**

```nginx
# The Mento web app (member + mentor sides, /apply, /signin) — one SPA.
# Rendered by deploy/render-nginx.sh from deploy/domains.env; never hand-edit the
# installed copy. TLS: `sudo certbot certonly --nginx -d SITE_HOST` once, BEFORE
# installing this file (the cert paths below must already exist for `nginx -t`).
#
# Every route boots the SPA and expo-router resolves it client-side. What protects
# a member is server-side (age gate, crisis scan on the Stream webhook, rate
# limits), so it holds on web. The staff dashboard is NOT served from this origin
# (it has its own host, so its token lives in a different localStorage).
server {
    listen 443 ssl;
    server_name SITE_HOST;

    root /opt/mento-console/current;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/SITE_HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/SITE_HOST/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # A missing static file is a real 404, never the SPA shell (a JS/CSS request
    # answered with index.html fails confusingly in the browser).
    location /_expo/ {
        try_files $uri =404;
    }
    location /assets/ {
        try_files $uri =404;
    }

    location /admin {
        return 404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name SITE_HOST;
    return 301 https://$host$request_uri;
}
```

- [ ] **Step 2: `deploy/nginx/mento-admin.conf.template`**

```nginx
# The Mento staff dashboard — its own origin, serving ONLY /admin from the same
# build as the app. Rendered by deploy/render-nginx.sh; TLS as in the app template.
# Own origin = the admin token's localStorage is unreadable from the consumer app,
# and this host can later be IP-restricted without touching the app.
server {
    listen 443 ssl;
    server_name SITE_HOST;

    root /opt/mento-console/current;
    index index.html;

    ssl_certificate /etc/letsencrypt/live/SITE_HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/SITE_HOST/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # try_files' fallback re-enters location matching; this exact match lets
    # /index.html resolve instead of hitting the catch-all 404 below.
    location = /index.html {
    }
    location = /favicon.ico {
        try_files $uri =404;
    }
    location /_expo/ {
        try_files $uri =404;
    }
    location /assets/ {
        try_files $uri =404;
    }

    location /admin {
        try_files $uri $uri/ /index.html;
    }

    location = / {
        return 302 /admin;
    }

    # The member app is deliberately not reachable from the staff origin.
    location / {
        return 404;
    }
}

server {
    listen 80;
    server_name SITE_HOST;
    return 301 https://$host$request_uri;
}
```

- [ ] **Step 3: `deploy/nginx/mento-redirect.conf.template`**

```nginx
# A host that only redirects (a legacy name, or the apex until it has a page).
# Rendered by deploy/render-nginx.sh. Keeps its own cert — the redirect is served
# over TLS. Browsers carry a #fragment across a redirect whose Location has none,
# so old private links (…/listener#token=…) keep signing people in.
server {
    listen 443 ssl;
    server_name SITE_HOST;

    ssl_certificate /etc/letsencrypt/live/SITE_HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/SITE_HOST/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    location /admin {
        return REDIRECT_CODE https://ADMIN_HOST$request_uri;
    }

    location / {
        return REDIRECT_CODE https://APP_HOST$request_uri;
    }
}

server {
    listen 80;
    server_name SITE_HOST;
    return 301 https://$host$request_uri;
}
```

- [ ] **Step 4: Delete the hardcoded conf**

Run: `git rm deploy/nginx/mento-console.conf`

- [ ] **Step 5: Run the proof — it must pass**

Run: `./deploy/test-nginx.sh`
Expected: `nginx: configuration file /etc/nginx/nginx.conf test is successful`, 21 `ok` lines, final line `nginx proof: all assertions held`, exit 0.

- [ ] **Step 6: Prove a domain change is one line**

```bash
sed -i 's/^ROOT_DOMAIN=.*/ROOT_DOMAIN=example.test/' deploy/domains.env
./deploy/test-nginx.sh | tail -1
git checkout deploy/domains.env
```

Expected: `nginx proof: all assertions held` (every host in the run was `*.example.test`), and `git status --short deploy/domains.env` prints nothing afterwards.

- [ ] **Step 7: Commit**

```bash
git add deploy/nginx
git commit -m "feat(deploy): app / admin / redirect nginx site templates; drop hardcoded mento-console.conf"
```

---

### Task 3: API settings — `APP_BASE_URL`, `ADMIN_BASE_URL`, CORS derivation

**Files:**
- Create: `services/api/tests/test_base_urls.py`
- Modify: `services/api/app/config.py` (the `console_base_url` / `cors_origins` block and `resolved_cors_origins`)
- Modify: `services/api/app/main.py` (two message strings)
- Modify: `services/api/.env.example` (the CORS block)

- [ ] **Step 1: Write the failing tests** — `services/api/tests/test_base_urls.py`

```python
"""Public web origins (spec 2026-09-19 unified-domains §3.3): APP_BASE_URL and
ADMIN_BASE_URL, the deprecated CONSOLE_BASE_URL fallback that keeps a
deploy-before-env-edit safe, and the CORS list derived from them. Pure Settings
tests — no app boot, no database.
"""

from __future__ import annotations

from app.config import Settings


def _settings(**kwargs) -> Settings:
    # _env_file=None keeps the developer's local .env out of these proofs.
    return Settings(_env_file=None, **kwargs)


def test_new_urls_fall_back_to_console_base_url():
    s = _settings(console_base_url="https://console.example")
    assert s.resolved_app_base_url == "https://console.example"
    assert s.resolved_admin_base_url == "https://console.example"


def test_new_urls_win_over_console_base_url():
    s = _settings(
        console_base_url="https://console.example",
        app_base_url="https://app.example",
        admin_base_url="https://admin.example",
    )
    assert s.resolved_app_base_url == "https://app.example"
    assert s.resolved_admin_base_url == "https://admin.example"


def test_each_url_falls_back_independently():
    s = _settings(console_base_url="https://console.example", app_base_url="https://app.example")
    assert s.resolved_app_base_url == "https://app.example"
    assert s.resolved_admin_base_url == "https://console.example"


def test_trailing_slash_is_dropped():
    s = _settings(app_base_url="https://app.example/", admin_base_url="https://admin.example//")
    assert s.resolved_app_base_url == "https://app.example"
    assert s.resolved_admin_base_url == "https://admin.example"


def test_prod_cors_derives_both_origins_in_order():
    s = _settings(
        env="prod",
        cors_origins="",
        app_base_url="https://app.example/x",
        admin_base_url="https://admin.example",
    )
    assert s.resolved_cors_origins == ["https://app.example", "https://admin.example"]


def test_prod_cors_dedupes_when_both_fall_back_to_console():
    s = _settings(env="prod", cors_origins="", console_base_url="https://console.example/x")
    assert s.resolved_cors_origins == ["https://console.example"]


def test_explicit_cors_origins_still_win():
    s = _settings(
        env="prod", cors_origins="https://only.example", app_base_url="https://app.example"
    )
    assert s.resolved_cors_origins == ["https://only.example"]
```

- [ ] **Step 2: Run — verify they fail**

```bash
cd services/api
PY="C:/Users/khana/Desktop/Mento/services/api/.venv/Scripts/python.exe"
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest tests/test_base_urls.py -q
```

Expected: failures — `AttributeError: 'Settings' object has no attribute 'resolved_app_base_url'` (and pydantic ignoring the unknown `app_base_url` kwarg).

- [ ] **Step 3: Implement in `services/api/app/config.py`**

Replace this block:

```python
    # Base URL the admin dashboard prints into copyable console links.
    console_base_url: str = "http://localhost:8081"

    # Comma-separated browser origins allowed by CORS outside dev (the listener
    # console and admin dashboard are web-only and call this API cross-origin).
    # Empty = fall back to console_base_url's origin so consoles work out of the box.
    cors_origins: str = ""
```

with:

```python
    # Public web origins (spec 2026-09-19 unified-domains §3.3). app = the one web
    # app (member + mentor sides, /apply, sign-in links); admin = the staff
    # dashboard's own origin. Links the API mints are built from these — see
    # app/services/links.py. Empty = fall back to console_base_url.
    app_base_url: str = ""
    admin_base_url: str = ""

    # DEPRECATED single-origin setting, kept as the fallback for both URLs above so
    # a deploy that lands before the env is edited cannot break link minting.
    console_base_url: str = "http://localhost:8081"

    # Comma-separated browser origins allowed by CORS outside dev (the web build
    # calls this API cross-origin). Empty = derive from the two base URLs above.
    cors_origins: str = ""
```

Add these two properties directly above `cors_origin_list`:

```python
    @property
    def resolved_app_base_url(self) -> str:
        return (self.app_base_url or self.console_base_url).rstrip("/")

    @property
    def resolved_admin_base_url(self) -> str:
        return (self.admin_base_url or self.console_base_url).rstrip("/")
```

Replace the body of `resolved_cors_origins` (keep the decorator and signature) with:

```python
        """Origins the CORS middleware should allow.

        Dev: wildcard (auth is bearer-token, credentials off, so "*" is valid).
        Otherwise: the configured CORS_ORIGINS list; if empty, the origins of the
        app and admin base URLs (deduped, app first) so the web build works
        without extra config.
        """
        if self.is_dev:
            return ["*"]
        configured = self.cors_origin_list
        if configured:
            return configured
        derived: list[str] = []
        for url in (self.resolved_app_base_url, self.resolved_admin_base_url):
            origin = origin_of(url)
            if origin and origin not in derived:
                derived.append(origin)
        return derived
```

- [ ] **Step 4: Update the two human-facing strings in `services/api/app/main.py`**

In `_enforce_prod_invariants`, replace

```python
            "CORS origin list is empty — set CORS_ORIGINS (comma-separated) or a "
            "valid CONSOLE_BASE_URL so the web consoles can reach the API"
```

with

```python
            "CORS origin list is empty — set CORS_ORIGINS (comma-separated) or valid "
            "APP_BASE_URL / ADMIN_BASE_URL so the web build can reach the API"
```

and in the module-level warning replace

```python
        "CORS_ORIGINS not set — falling back to console_base_url origin %s; "
```

with

```python
        "CORS_ORIGINS not set — falling back to the app/admin base URL origins %s; "
```

Also update the two comments that say "console_base_url" next to those strings (the docstring bullet "they call this API cross-origin from console_base_url" → "the web build calls this API cross-origin from APP_BASE_URL / ADMIN_BASE_URL"; the comment above the warning "falling back to console_base_url's origin" → "falling back to the app/admin base URL origins").

- [ ] **Step 5: Update `services/api/.env.example`** — replace the block from `# --- CORS (web-only…` through `CONSOLE_BASE_URL=http://localhost:8081` with:

```bash
# --- Public web origins + CORS (the web build calls the API cross-origin) ---
# APP_BASE_URL   = the one web app (member + mentor sides, /apply, sign-in links)
# ADMIN_BASE_URL = the staff dashboard's own origin
# Links the API mints are built from these. Hostnames live in deploy/domains.env;
# prod: https://app.<root> and https://admin.<root>.
APP_BASE_URL=http://localhost:8081
ADMIN_BASE_URL=http://localhost:8081
# Comma-separated browser origins allowed outside dev. Dev uses a wildcard. If
# unset outside dev, the API derives the two origins above (and logs a warning) —
# set it explicitly for staging/prod.
CORS_ORIGINS=
# DEPRECATED — fallback for both URLs above when they are empty. Remove once prod
# sets APP_BASE_URL + ADMIN_BASE_URL.
CONSOLE_BASE_URL=http://localhost:8081
```

- [ ] **Step 6: Run the new + existing settings tests**

```bash
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest tests/test_base_urls.py tests/test_cors_config.py -q
```

Expected: `17 passed`.

- [ ] **Step 7: Commit**

```bash
git add services/api/app/config.py services/api/app/main.py services/api/.env.example services/api/tests/test_base_urls.py
git commit -m "feat(api): APP_BASE_URL + ADMIN_BASE_URL with CONSOLE_BASE_URL fallback; CORS derived from both"
```

---

### Task 4: One home for minted links — `app/services/links.py`

**Files:**
- Create: `services/api/app/services/links.py`
- Modify: `services/api/tests/test_base_urls.py` (append)
- Modify: `services/api/app/routers/admin_console.py` (two call sites: the `listener.link_issued` endpoint and the `admin.created` endpoint)
- Modify: `services/api/app/routers/listener_applications.py` (the `console_url` line)

- [ ] **Step 1: Append the failing tests to `services/api/tests/test_base_urls.py`**

```python
# --- link builders (app/services/links.py) ---


def test_mentor_console_link_uses_the_app_origin():
    from app.services.links import mentor_console_link

    s = _settings(app_base_url="https://app.example/", admin_base_url="https://admin.example")
    assert mentor_console_link("tok.en", s) == "https://app.example/listener#token=tok.en"


def test_admin_link_uses_the_admin_origin():
    from app.services.links import admin_link

    s = _settings(app_base_url="https://app.example", admin_base_url="https://admin.example")
    assert admin_link("tok.en", s) == "https://admin.example/admin#token=tok.en"


def test_links_fall_back_to_console_base_url():
    from app.services.links import admin_link, mentor_console_link

    s = _settings(console_base_url="https://console.example")
    assert mentor_console_link("t", s) == "https://console.example/listener#token=t"
    assert admin_link("t", s) == "https://console.example/admin#token=t"
```

- [ ] **Step 2: Run — verify they fail**

```bash
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest tests/test_base_urls.py -q
```

Expected: 3 failures, `ModuleNotFoundError: No module named 'app.services.links'`.

- [ ] **Step 3: Write `services/api/app/services/links.py`**

```python
"""Every URL the API hands to a person is built here, from the two public web
origins in Settings — never formatted inline in a router. The token rides in the
#fragment: browsers never send it to a server, and it survives the redirects the
legacy hosts serve (spec 2026-09-19 unified-domains §3.1).

The paths are the current ones; routes-spec step 3 moves the mentor link to
/signin — one line, here.
"""

from __future__ import annotations

from app.config import Settings, get_settings


def mentor_console_link(token: str, settings: Settings | None = None) -> str:
    s = settings or get_settings()
    return f"{s.resolved_app_base_url}/listener#token={token}"


def admin_link(token: str, settings: Settings | None = None) -> str:
    s = settings or get_settings()
    return f"{s.resolved_admin_base_url}/admin#token={token}"
```

- [ ] **Step 4: Switch the three call sites**

`services/api/app/routers/admin_console.py` — add to the imports: `from app.services.links import admin_link, mentor_console_link`.

Replace

```python
    token = issue_listener_token(li.id)
    base = get_settings().console_base_url
    audit.record(db, admin, "listener.link_issued", subject_type="listener", subject_id=listener_id)
    db.commit()
    return AdminConsoleLinkOut(url=f"{base}/listener#token={token}")
```

with

```python
    token = issue_listener_token(li.id)
    audit.record(db, admin, "listener.link_issued", subject_type="listener", subject_id=listener_id)
    db.commit()
    return AdminConsoleLinkOut(url=mentor_console_link(token))
```

Replace

```python
    return AdminCreatedOut(id=a.id, url=f"{get_settings().console_base_url}/admin#token={token}")
```

with

```python
    return AdminCreatedOut(id=a.id, url=admin_link(token))
```

`services/api/app/routers/listener_applications.py` — add `from app.services.links import mentor_console_link`; replace

```python
            console_url = f"{get_settings().console_base_url}/listener#token={token}"
```

with

```python
            console_url = mentor_console_link(token)
```

Then, in both routers, run `grep -n "get_settings" <file>`; if the only remaining hit is the import line, remove `get_settings` from that import (ruff flags unused imports).

- [ ] **Step 5: Run the link tests + the router suites that exercise the call sites (isolated DB)**

```bash
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest tests/test_base_urls.py tests/test_cors_config.py tests/test_listener_applications.py -q
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest tests -q -k "admin"
```

Expected: all pass, 0 failures (`test_listener_applications.py` line 250 still finds `/listener#token=` in the approved applicant's `console_url`).

- [ ] **Step 6: Full gate for the API layer (isolated DB) + style**

```bash
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m pytest -q
DATABASE_URL="postgresql+psycopg://mento:mento@localhost:5432/mento_wt" "$PY" -m alembic check
"$PY" -m ruff check app tests
"$PY" -m black --check app tests
```

Expected: pytest green with 0 failures (a Postgres-only skip is not a pass — there must be none, this DB is Postgres); `No new upgrade operations detected.`; ruff `All checks passed!`; black `would be left unchanged`. **No re-seed needed** — the shared dev DB was never touched.

- [ ] **Step 7: Commit**

```bash
git add services/api/app/services/links.py services/api/app/routers/admin_console.py services/api/app/routers/listener_applications.py services/api/tests/test_base_urls.py
git commit -m "refactor(api): minted links built in services/links.py from the app/admin origins"
```

---

### Task 5: `deploy-web.sh` + the CI workflow read `domains.env`

**Files:**
- Rename: `deploy/deploy-console.sh` → `deploy/deploy-web.sh` (then edit)
- Create: `deploy/deploy-console.sh` (wrapper)
- Modify: `.github/workflows/console-deploy.yml`

- [ ] **Step 1: Rename**

Run: `git mv deploy/deploy-console.sh deploy/deploy-web.sh`

- [ ] **Step 2: Replace the whole of `deploy/deploy-web.sh` with**

```bash
#!/usr/bin/env bash
# Run LOCALLY (on the dev machine, from repo root) to build and ship the web build
# — the one SPA behind the app host AND the admin host — to the VPS. Unlike
# deploy.sh, this does NOT run on the VPS: the box is a 1-2GB Debian VPS and can't
# reliably run the Expo/Metro toolchain (large node_modules, memory-hungry
# bundler). The static build itself is tiny; only the BUILD step needs a real
# machine. Hostnames + SSH target come from deploy/domains.env.
#
#   ./deploy/deploy-web.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
set -a
# shellcheck source=domains.env
. "$HERE/domains.env"
set +a
REMOTE_BASE="/opt/mento-console"   # directory name predates the host split; Nginx roots point here

cd "$HERE/../apps/mobile"

if [ ! -f .env.production ]; then
    echo "[deploy-web] missing apps/mobile/.env.production — see .env.example for the shape; needs EXPO_PUBLIC_API_URL=https://${API_HOST}/api/v1 + the prod EXPO_PUBLIC_STREAM_API_KEY." >&2
    exit 1
fi

echo "[deploy-web] building static web export (prod env)..."
rm -rf dist
npx expo export --platform web

echo "[deploy-web] uploading..."
# tar stream, not `scp -r`: on Windows OpenSSH `scp -r dist host:new` races its own
# directory creation ("remote setstat … No such file or directory") and leaves a
# partial upload (session 31f). tar is atomic per file and exits non-zero on failure.
ssh "$VPS_SSH" "rm -rf ${REMOTE_BASE}/new && mkdir -p ${REMOTE_BASE}/new"
tar -C dist -cf - . | ssh "$VPS_SSH" "tar -C ${REMOTE_BASE}/new -xf -"

echo "[deploy-web] swapping in atomically..."
ssh "$VPS_SSH" "
set -e
cd ${REMOTE_BASE}
rm -rf old
[ -d current ] && mv current old || true
mv new current
"

echo "[deploy-web] verifying..."
sleep 1
fail=0
check() {
    local url=$1 want=$2 code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url")
    if [ "$code" != "$want" ]; then
        echo "[deploy-web] FAILED — $url returned $code (expected $want)" >&2
        fail=1
    else
        echo "[deploy-web] $url -> $code"
    fi
}
check "https://${APP_HOST}/" 200
check "https://${APP_HOST}/onboarding" 200
check "https://${APP_HOST}/apply" 200
check "https://${APP_HOST}/admin" 404
check "https://${ADMIN_HOST}/admin" 200
[ "$fail" -eq 0 ] || exit 1

echo "[deploy-web] done."
```

- [ ] **Step 3: Create the wrapper `deploy/deploy-console.sh`**

```bash
#!/usr/bin/env bash
# Renamed to deploy-web.sh (2026-09-19: the build is the whole web app, not a
# console). This wrapper keeps muscle memory + old docs working for one release.
exec "$(dirname "${BASH_SOURCE[0]}")/deploy-web.sh" "$@"
```

Run: `chmod +x deploy/deploy-web.sh deploy/deploy-console.sh`

- [ ] **Step 4: Syntax-check both (no deploy is run here)**

Run: `bash -n deploy/deploy-web.sh && bash -n deploy/deploy-console.sh && bash -n deploy/render-nginx.sh && bash -n deploy/test-nginx.sh && echo syntax-ok`
Expected: `syntax-ok`

- [ ] **Step 5: Update `.github/workflows/console-deploy.yml`**

Replace the header comment's first sentence "Rebuilds and ships the admin/listener/apply static web console to the VPS" with "Rebuilds and ships the web build (app host + admin host) to the VPS", and `deploy/deploy-console.sh` with `deploy/deploy-web.sh` everywhere in that comment.

Replace the `paths:` list with:

```yaml
    paths:
      - "apps/mobile/**"
      - "deploy/deploy-web.sh"
      - "deploy/domains.env"
      - ".github/workflows/console-deploy.yml"
```

Replace the `Set up SSH` step's `run:` block with:

```yaml
        run: |
          . deploy/domains.env
          mkdir -p ~/.ssh
          printf '%s\n' "$CONSOLE_DEPLOY_SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          ssh-keyscan -H "${VPS_SSH#*@}" >> ~/.ssh/known_hosts
```

Replace the last step with:

```yaml
      - name: Deploy web build
        run: ./deploy/deploy-web.sh
```

- [ ] **Step 6: Prove no hostname is hardcoded outside `domains.env` in deploy code**

Run: `grep -rnE "agentin\.chat|87\.232\.72\.79" deploy .github | grep -v "^deploy/domains.env"`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add deploy .github/workflows/console-deploy.yml
git commit -m "feat(deploy): deploy-web.sh + CI read hosts from domains.env; deploy-console.sh kept as a wrapper"
```

---

### Task 6: Docs match reality

**Files:**
- Modify: `docs/DEPLOYMENT_VPS.md` (§5 env list, §11, new "Changing the domain" section)
- Modify: `CLAUDE.md` (stack row "Mobile", repo-layout `deploy/` lines, key env vars)

- [ ] **Step 1: `docs/DEPLOYMENT_VPS.md` §5** — in the "Set at minimum" sentence replace `` `CORS_ORIGINS`, `CONSOLE_BASE_URL`, `` with `` `APP_BASE_URL`, `ADMIN_BASE_URL`, `CORS_ORIGINS` (hosts from `deploy/domains.env`), ``.

- [ ] **Step 2: `docs/DEPLOYMENT_VPS.md` §11** — replace everything from the heading `### 11. Admin dashboard, listener console, public apply page (web)` up to (not including) the next `---` with:

````markdown
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
````

- [ ] **Step 3: `CLAUDE.md`** — three edits:

1. Stack table, "Mobile" row: replace `` also served whole on prod at `console.agentin.chat/` (founder ruling 2026-09-19; landing + journey next to `/admin` `/listener` `/apply`). `` with `` also served whole on prod at the app host (`app.<root>`, founder ruling 2026-09-19); the staff dashboard has its own host (`admin.<root>`); hostnames live only in `deploy/domains.env`. ``
2. Key env vars line: replace `` `DATABASE_URL`, `` with `` `DATABASE_URL`, `APP_BASE_URL`/`ADMIN_BASE_URL` (`CONSOLE_BASE_URL` = deprecated fallback), ``.
3. Repo layout, the `deploy/` entry: replace `docker-compose.prod.yml + deploy.sh + deploy-console.sh + backup-postgres.sh +` and the two lines after it, up to `runbook docs/DEPLOYMENT_VPS.md)`, with:

```
                            domains.env (the ONLY place hostnames live) + docker-compose.prod.yml + deploy.sh +
                            deploy-web.sh + render-nginx.sh + test-nginx.sh + backup-postgres.sh +
                            nginx/{mento-api,mento-app,mento-admin,mento-redirect}.conf.template (self-managed VPS —
                            LIVE: api.<root>, app.<root>, admin.<root>; console.<root> redirects; runbook docs/DEPLOYMENT_VPS.md)
```

- [ ] **Step 4: Commit** (the spec's §3.2 / §4.5 were already synced with this plan when it was written)

```bash
git add docs CLAUDE.md
git commit -m "docs: web build served from app/admin hosts; domain-change runbook"
```

---

### Task 7: Prod rollout — **operator-gated, one sub-step at a time**

Nothing here needs the API code from Tasks 3–4. Ask the founder before each sub-step; report the literal output after each. `. deploy/domains.env` first in every shell.

- [ ] **7a. DNS precheck**

Run: `for h in $APP_HOST $ADMIN_HOST; do printf "%-24s" $h; nslookup $h 2>/dev/null | awk '/^Address/ && !/#/ {a=$2} END{print a}'; done`
Expected: both print `87.232.72.79`. `APP_HOST` already does. If `ADMIN_HOST` is empty, do 7b/7c/7d for the app host only and **stop before 7e** until the founder adds the `admin` A record.

- [ ] **7b. Certificates (no site change yet)**

```bash
ssh "$VPS_SSH" "sudo certbot certonly --nginx -d $APP_HOST --non-interactive --agree-tos -m geekspacetech02@gmail.com"
ssh "$VPS_SSH" "sudo certbot certonly --nginx -d $ADMIN_HOST --non-interactive --agree-tos -m geekspacetech02@gmail.com"
ssh "$VPS_SSH" "sudo ls /etc/letsencrypt/live/"
```

Expected: `Successfully received certificate` twice; the listing shows both hosts next to `api.` and `console.`.

- [ ] **7c. Allow the new origins in prod CORS (env only — no code deploy)**

```bash
ssh "$VPS_SSH" "grep -n '^CORS_ORIGINS' /opt/mento/services/api/.env"
```

Show the founder the current value, then set it to the current origins **plus** the two new ones (keep `console.` until 7f is proven):

```bash
ssh "$VPS_SSH" "cd /opt/mento && cp services/api/.env services/api/.env.bak-\$(date +%Y%m%d-%H%M%S) \
  && sed -i 's#^CORS_ORIGINS=.*#CORS_ORIGINS=https://console.$ROOT_DOMAIN,https://$APP_HOST,https://$ADMIN_HOST#' services/api/.env \
  && docker compose -f deploy/docker-compose.prod.yml --env-file services/api/.env up -d api"
curl -s -o /dev/null -w "%{http_code}\n" "https://$API_HOST/api/v1/health"
curl -s -D - -o /dev/null -H "Origin: https://$APP_HOST" "https://$API_HOST/api/v1/health" | grep -i "access-control-allow-origin"
```

Expected: `200`, then `access-control-allow-origin: https://app.agentin.chat`.

- [ ] **7d. Install the app site**

```bash
./deploy/render-nginx.sh app | ssh "$VPS_SSH" "cat > /tmp/mento-app.conf"
ssh "$VPS_SSH" 'set -e; sudo cp /tmp/mento-app.conf /etc/nginx/sites-available/mento-app.conf
sudo ln -sf /etc/nginx/sites-available/mento-app.conf /etc/nginx/sites-enabled/mento-app.conf
if sudo nginx -t; then sudo systemctl reload nginx && echo RELOADED; else sudo rm -f /etc/nginx/sites-enabled/mento-app.conf; echo "nginx -t FAILED — site disabled"; exit 1; fi'
for p in / /onboarding /apply /admin /_expo/nope.js; do printf "%-16s" $p; curl -s -o /dev/null -w "%{http_code}\n" "https://$APP_HOST$p"; done
```

Expected: `RELOADED`; `200 200 200 404 404`. Then run the read-only browser smoke from session 34 against `https://$APP_HOST/` (landing renders, Start → role fork, 0 page errors, **0 API writes**, normal + reduced motion) — it also proves CORS from the new origin, because the landing's session check calls the API.

- [ ] **7e. Install the admin site** (needs the `admin` A record + cert)

Same shape as 7d with `admin` / `mento-admin.conf`. Verify:

```bash
for p in / /admin /onboarding; do printf "%-14s" $p; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://$ADMIN_HOST$p"; done
```

Expected: `302 https://admin.agentin.chat/admin`, `200`, `404`. Founder opens their admin link with the host swapped to `admin.` and confirms the dashboard loads (their token is per-origin — they sign in once on the new host with a fresh `#token=` link: `python -m scripts.issue_admin_token --admin-id <uuid>` on the VPS, or the Admins tab from the old host **before** 7f).

- [ ] **7f. Flip `console.` to redirects**

```bash
./deploy/render-nginx.sh legacy "console.$ROOT_DOMAIN" | ssh "$VPS_SSH" "cat > /tmp/mento-legacy-console.conf"
ssh "$VPS_SSH" 'set -e; BAK=/tmp/mento-console.conf.bak-$(date +%Y%m%d-%H%M%S)
sudo cp /etc/nginx/sites-available/mento-console.conf "$BAK"; echo "backup: $BAK"
sudo cp /tmp/mento-legacy-console.conf /etc/nginx/sites-available/mento-console.conf
if sudo nginx -t; then sudo systemctl reload nginx && echo RELOADED; else sudo cp "$BAK" /etc/nginx/sites-available/mento-console.conf; echo "nginx -t FAILED — restored"; exit 1; fi'
for p in / /listener "/apply?x=1" /admin; do printf "%-14s" "$p"; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://console.$ROOT_DOMAIN$p"; done
```

Expected: `301 https://app.agentin.chat/`, `301 https://app.agentin.chat/listener`, `301 https://app.agentin.chat/apply?x=1`, `301 https://admin.agentin.chat/admin`. (The installed filename stays `mento-console.conf` so the existing `sites-enabled` symlink keeps working.)

Browser check (fragment survival): open `https://console.agentin.chat/listener#token=x` — the address bar must end up at `https://app.agentin.chat/listener#token=x`.

- [ ] **7g. After this branch is merged to `master` and pushed (founder's call)**

```bash
ssh "$VPS_SSH" "cd /opt/mento && ./deploy/backup-postgres.sh && ./deploy/deploy.sh"
ssh "$VPS_SSH" "cd /opt/mento && cp services/api/.env services/api/.env.bak-\$(date +%Y%m%d-%H%M%S) \
  && grep -q '^APP_BASE_URL=' services/api/.env || printf 'APP_BASE_URL=https://$APP_HOST\nADMIN_BASE_URL=https://$ADMIN_HOST\n' >> services/api/.env"
ssh "$VPS_SSH" "cd /opt/mento && sed -i 's#^CORS_ORIGINS=.*#CORS_ORIGINS=https://$APP_HOST,https://$ADMIN_HOST#' services/api/.env \
  && docker compose -f deploy/docker-compose.prod.yml --env-file services/api/.env up -d api"
curl -s "https://$API_HOST/api/v1/health"
```

Expected: `{"status":"ok"}`. Then in the admin dashboard issue a mentor console link and confirm it starts with `https://app.agentin.chat/listener#token=`.

- [ ] **7h. Record it** — `PROGRESS.md` session entry (Done / Shipped with the literal proofs / Open decisions: apex record, `/listener` redirect lifetime) via the `mento-session-end` skill; commit.

---

### Task 8 (optional, when the founder adds an apex A record): apex → app

```bash
. deploy/domains.env
ssh "$VPS_SSH" "sudo certbot certonly --nginx -d $ROOT_DOMAIN --non-interactive --agree-tos -m geekspacetech02@gmail.com"
./deploy/render-nginx.sh apex | ssh "$VPS_SSH" "cat > /tmp/mento-apex.conf"
ssh "$VPS_SSH" 'set -e; sudo cp /tmp/mento-apex.conf /etc/nginx/sites-available/mento-apex.conf
sudo ln -sf /etc/nginx/sites-available/mento-apex.conf /etc/nginx/sites-enabled/mento-apex.conf
if sudo nginx -t; then sudo systemctl reload nginx && echo RELOADED; else sudo rm -f /etc/nginx/sites-enabled/mento-apex.conf; echo "nginx -t FAILED — site disabled"; exit 1; fi'
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://$ROOT_DOMAIN/"
```

Expected: `RELOADED`, then `302 https://app.agentin.chat/`.

---

## Self-review (done while writing)

- **Spec coverage:** §3.1 host map → Tasks 2, 7d–7f, 8 · §3.2 one source → Tasks 1, 5 · §3.3 API settings → Task 3 (+ links, Task 4) · §3.4 runbook → Task 6 §12 · §7 proofs → `test-nginx.sh`, `test_base_urls.py`, 7d smoke. Routes (§4) are out of scope by design — later plans.
- **Names are consistent:** `resolved_app_base_url` / `resolved_admin_base_url` (Task 3) are the names used in `links.py` and the tests (Task 4); `mentor_console_link` / `admin_link` match between tests, module and call sites; template tokens `SITE_HOST` / `APP_HOST` / `ADMIN_HOST` / `REDIRECT_CODE` match `render-nginx.sh`.
- **No placeholders:** every code step carries the code; every command has its expected output.
