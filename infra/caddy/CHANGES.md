# App/config changes needed for the qa-api / qa-app / qa-admin split

None of these are made by this branch — this is the list to execute
separately once the cutover is scheduled, since each one is a live
app/service config change, not a repo file.

## 1. Mobile build — API base URL

`apps/mobile/lib/api.ts` resolves the API origin from, in order:
`process.env.EXPO_PUBLIC_API_URL` → `Constants.expoConfig.extra.apiUrl` →
`http://localhost:8000/api/v1`. Today's QA/staging builds get
`EXPO_PUBLIC_API_URL=https://staging.mento.chat/api/v1` from an EAS
environment variable (not in the repo — `eas.json`'s `staging`/`preview`
profiles carry no `EXPO_PUBLIC_API_URL`, so it's set in the EAS project
dashboard or passed at build time).

- **Change:** point the QA build profile's `EXPO_PUBLIC_API_URL` at
  `https://qa-api.mento.chat/api/v1` instead. Decide whether this is a new
  EAS profile (`qa`, cleanly separate from `staging`) or an in-place edit of
  the existing `staging` profile's env var — an in-place edit means every
  future `staging`-channel build silently moves hosts, which is the kind of
  thing that should be a deliberate decision, not a side effect of this
  infra change.

## 2. API — CORS allowed origins

`services/api/app/config.py`: `cors_origins` (comma-separated, env
`CORS_ORIGINS`) is empty by default and falls back to
`resolved_app_base_url` + `resolved_admin_base_url` (themselves `APP_BASE_URL`
/ `ADMIN_BASE_URL`, falling back to the deprecated single `CONSOLE_BASE_URL`).
`app/main.py` wires `CORSMiddleware(allow_origins=settings.resolved_cors_origins)`.

- **Change:** QA's API env needs `APP_BASE_URL=https://qa-app.mento.chat`,
  `ADMIN_BASE_URL=https://qa-admin.mento.chat`, and either leave
  `CORS_ORIGINS` empty (it'll derive from those two) or set it explicitly to
  `https://qa-app.mento.chat,https://qa-admin.mento.chat` — explicit is
  safer during the transition since `staging.mento.chat` also needs to stay
  in the allowlist until it's retired (see item 5): `CORS_ORIGINS=https://qa-app.mento.chat,https://qa-admin.mento.chat,https://staging.mento.chat`.
  This lives in `deploy/staging/secrets/api.env` on the box (not committed).

## 3. Cookies / session domain

**No change needed — the API sets no cookies.** Checked
`services/api/app/`: no `set_cookie`, no `Cookie`/`SameSite` usage anywhere.
Auth is bearer JWT (access + refresh tokens returned in the response body,
per `sessions` table / WS3 T3.2), so there is no cookie `Domain=` attribute
tied to `staging.mento.chat` that would break on a host split.

## 4. Admin base URL / links

Covered by item 2 (`ADMIN_BASE_URL`) — the API mints links (password-reset
style flows, console links) from `resolved_admin_base_url` in
`app/services/links.py`. Once `ADMIN_BASE_URL=https://qa-admin.mento.chat`
is set, those links point at the new host automatically; no code change.

## 5. Stream webhook URLs

`services/api/scripts/configure_stream.py` points the Stream app at
`<base>/api/v1/stream/before-message-send` (sync, "before-message-send") and
`<base>/api/v1/stream/webhook` (async). The staging README documents running
it once per base URL change:
`docker compose exec -T api python -m scripts.configure_stream https://staging.mento.chat`.

- **Change:** once `qa-api.mento.chat` is live and verified, re-run it against
  the new base: `python -m scripts.configure_stream https://qa-api.mento.chat`.
  **Do this last, deliberately, not as part of the Caddy cutover** — the
  staging README already warns this project's Stream app has synchronous and
  asynchronous hooks "pointed at staging" live; repointing them is what
  actually moves production-adjacent chat traffic, and it's a one-way flip
  (the old hooks stop being called the moment the new URL is configured).
  This is also why the runbook below keeps `staging.mento.chat` serving
  identically through Caddy — the Caddy/nginx swap and the Stream webhook
  repoint are two separate, independently-reversible steps.

## 6. Nothing else found

No `.env`/secrets files reference `staging.mento.chat` as a literal elsewhere
in the API beyond what's listed (checked `app/` for hardcoded hostnames —
none; everything routes through `APP_BASE_URL`/`ADMIN_BASE_URL`/`CORS_ORIGINS`/
Stream config). `POSTHOG_HOST`, `RAZORPAY_*`, `SENTRY_DSN` are
provider-side, not host-split-dependent.
