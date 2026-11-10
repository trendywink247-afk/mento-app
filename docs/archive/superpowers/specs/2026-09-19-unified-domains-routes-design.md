# Unified domains + routes — design

**Date:** 2026-09-19 · **Status:** draft for founder review · **Source rulings (founder, session 34):** the web build is a public surface, not a locked-down console; "domains and all the routing should be normalized… navigation within the app with minimal URL changes… single unified experience"; brand domain is `agentin.chat` **for now and must be swappable**; route cleanup level **A (full normalize)**. Desktop layout is its own spec: `2026-09-19-desktop-web-layout-design.md`.

Source-of-truth order applies: DECISIONS → PRD → mockups. Vocabulary (DECISIONS §K.1) is a hard constraint: **"listener" never appears in a URL a person can see**; code, tables and API paths keep it.

---

## 1. Goal

One product, one URL space, hostnames that say what they serve, and a domain that can change without touching code.

Today: `console.agentin.chat` serves the consumer app, the mentor console, the staff dashboard and the recruitment page. `/mentor/*` means two opposite things (a member looking at a mentor; the mentor's own screens). Two mentor consoles exist (`/mentor-home`, `/listener`) over the same chat screen. Two application forms exist. Hostnames are hardcoded in the Nginx conf, the deploy script, the CI workflow and one API setting.

## 2. Non-goals

- No API path, table, testID or analytics-event renames. (No analytics event carries a path — verified.)
- No universal/app links (they bake a domain into the APK — deferred until the domain is final). `mento://` scheme unchanged.
- No separate admin bundle (same SPA, host-isolated by Nginx — see §3.3). No marketing site at the apex.
- No desktop layout work (other spec).

---

## 3. Domains

### 3.1 Host map

| Host | Serves | DNS |
|---|---|---|
| `app.<root>` | the one app — landing, journey, member + mentor sides, `/apply`, `/signin` | A record **exists** → 87.232.72.79 (no site/cert yet) |
| `api.<root>` | API | unchanged |
| `admin.<root>` | **only** `/admin` (+ `/_expo/`, `/assets/`); `/` → 302 `/admin`; anything else 404 | **new A record (founder)** |
| `console.<root>` | legacy: `/admin*` → 301 `admin.`; everything else → 301 `app.` (path + query preserved) | unchanged; cert stays (the 301 is served over TLS) |
| `<root>` (apex) | 302 → `app.` until a marketing page exists | new A record (founder, optional — step 1 ships without it) |

`app.` 404s `/admin` on direct load. Browsers carry the `#token=` fragment across a 301 whose `Location` has no fragment, so every private link already handed out keeps signing people in.

Why `admin.` is a separate origin: `localStorage` is per-origin, so the admin token is unreadable from the consumer origin, and the host can later be IP-restricted or put behind basic auth without touching the app.

### 3.2 One source for hostnames

`deploy/domains.env` (committed; no secrets):

```
ROOT_DOMAIN=agentin.chat
APP_HOST=app.${ROOT_DOMAIN}
API_HOST=api.${ROOT_DOMAIN}
ADMIN_HOST=admin.${ROOT_DOMAIN}
LEGACY_HOSTS=console.${ROOT_DOMAIN}
VPS_SSH=mento-ops@87.232.72.79
```

Consumers:

- Three site templates — `deploy/nginx/mento-{app,admin,redirect}.conf.template` (one site per file, like `mento-api.conf`; they replace the hardcoded `mento-console.conf`), cert paths derived from the host. Rendered by `deploy/render-nginx.sh app|admin|legacy <host>|apex` (sources `domains.env`, `sed`, stdout). `deploy/test-nginx.sh` is the committed proof: every site in a throwaway `nginx:1.22`, host map asserted row by row.
- `deploy/deploy-web.sh` (renamed from `deploy-console.sh`; the old name stays as a one-line wrapper for one release) — sources `domains.env` for the SSH target and the post-deploy checks (`https://$APP_HOST/`, `/onboarding`, `/apply`, `https://$ADMIN_HOST/admin`).
- `.github/workflows/console-deploy.yml` — sources the same file instead of hardcoding the IP/host.

### 3.3 API settings

`app/config.py`: add `app_base_url` and `admin_base_url`. `console_base_url` stays as a **deprecated fallback** for both (empty new value ⇒ old value), so a deploy that lands before the env is edited cannot break link minting. `resolved_cors_origins` = explicit `CORS_ORIGINS`, else the origins of `app_base_url` + `admin_base_url`. The boot invariant ("CORS list must not be empty outside dev") is unchanged.

Prod `.env` after step 1: `APP_BASE_URL=https://app.agentin.chat`, `ADMIN_BASE_URL=https://admin.agentin.chat`, `CORS_ORIGINS=https://app.agentin.chat,https://admin.agentin.chat`.

The mobile build needs nothing new: routes are relative and the API origin is already `EXPO_PUBLIC_API_URL`.

### 3.4 Changing the domain later (the runbook this design buys)

1. A records for `app`, `api`, `admin` (and apex) on the new root.
2. Edit `ROOT_DOMAIN` in `deploy/domains.env`; add the old hosts to `LEGACY_HOSTS`.
3. `certbot --nginx -d …` for the new hosts; `render-nginx.sh` → copy → `nginx -t` → reload.
4. Three API env values (`APP_BASE_URL`, `ADMIN_BASE_URL`, `CORS_ORIGINS`) → `deploy.sh`.
5. `EXPO_PUBLIC_API_URL` in `apps/mobile/.env.production` → `deploy-web.sh` + OTA.
6. `scripts.configure_stream` with the new API URL (**the crisis webhook is dead until this runs** — prove it per the mento-crisis-webhook skill).

Old hosts keep 301-ing for as long as their DNS + certs live.

---

## 4. Routes

Principle: **a URL names a thing; the session decides the view.**

### 4.1 Map

| Today | Becomes | Notes |
|---|---|---|
| `/` | `/` | already the role-aware entry (new → landing; returning → `/chats` or the mentor's home). No separate `/home`. |
| `/onboarding`, tabs (`/chats` `/path` `/journals` `/profile` `/mentors`), `/reflection`, `/coffee`, `/start-fresh`, `/admin` | unchanged | |
| `/chat/[id]` · `/mentor/chat/[id]` · `/listener/chat/[id]` | **`/chat/[id]`** | one route, resolver picks the view (§4.2) |
| `/mentor-profile/[id]` (member → mentor) · `/mentor/member/[id]` (mentor → member) | **`/chat/[id]/about`** | "the other person in this chat"; same resolver |
| `/mentor/report` (`?id=`) | **`/chat/[id]/report`** | mentor-side sheet; the member's report stays an in-screen option, unchanged |
| `/mentor/helplines` | **`/helplines`** | transparentModal |
| `/mentor-home` | **`/mentoring`** | application form · status · console — one noun for the activity |
| `/mentor/line` | **`/mentoring/line`** | transparentModal |
| `/mentor/[id]` (Browse profile, by listener id) | **`/mentors/[id]`** | sits under the `/mentors` list. Plan task 1 verifies expo-router accepts `mentors/[id].tsx` beside `(tabs)/mentors.tsx`; if it does not, this row stays `/mentor/[id]` and nothing else changes. |
| `/listener` + `#token=` | **`/signin#token=…`** | §4.3; `ListenerConsole.web` is deleted (cleanup step) |
| `/apply` · `/listener-apply` | **`/apply`** | one screen: member session present → in-app flow (status card, cooldown); absent → today's public flow (mints the throwaway user). `ApplicationForm` is already shared. |
| `/journal/[channel]` · `/journal/organize` | **`/journals/[channel]`** · **`/journals/organize`** | matches the tab |

File layout consequence: `app/chat/[id].tsx` becomes `app/chat/[id]/{index,about,report}.tsx` with a `_layout.tsx` Stack; the root Stack's `chat/[id]` fade option moves to that group, and the `mentor-home` fade option follows the rename. The comment in today's `chat/[id].tsx` still binds: **platform splits live in directly imported components, never in route files**, so `require.context` cannot pull `stream-chat-expo` into the web bundle.

### 4.2 The resolver — `components/chat/ChatRoute.tsx`

Used by `/chat/[id]` and `/chat/[id]/about`. Decides `member | mentor | none` by **ownership, not by URL** — the rule `lib/notifications.ts` already applies to push taps:

1. Member session on device **and** `id` ∈ `api.listConversations()` → member view (`ChatScreen` / `MentorProfileScreen`).
2. Else listener token on device → mentor view (`MentorChatScreen` / `MemberBriefScreen`); the server's existing scoping is the authority — a 403/404 there falls to 3.
3. Else → `router.replace('/')`.

Details: the verdict is cached per conversation id in a module map (re-focus never re-resolves). While resolving, the screen shows the static ambient ground — no spinner before 150 ms, no layout jump. A dual-role device where both sessions could claim an id resolves **member first** (same as push today). `lib/notificationRoute.ts` collapses: every `message`/`accepted` tap routes to `/chat/[id]`; `request` taps route to `/mentoring`.

### 4.3 `/signin` and token-only mentoring

`/signin` reads `#token=…` exactly as `ListenerConsole.web` does today (store via `saveListenerToken`, strip the hash with `history.replaceState`, handle `hashchange` for a second link opened in the same tab), then `saveRole('mentor')` and `router.replace('/mentoring')`. With no token it shows a still, branded "this link has expired or is incomplete" card with a way back to `/`. In dev (API `ENV=dev`) it keeps the dev listener picker the e2e scripts rely on.

`/mentoring` today assumes a member session + an approved application. New rule: **a listener token on device is sufficient** — the console renders straight away; the application fetch is skipped when there is no member session; the hero takes persona/companion from `GET /listener/me`. "Switch to talk" with no member session goes to `/` (the journey mints one). This is what lets admin-created mentors (token link only) use the same home as applicants, and what makes deleting the old console safe.

### 4.4 Legacy redirects (one release)

Every old path keeps a route file that is only an expo-router `<Redirect>` to the new path, params carried: `/mentor-home`, `/mentor/chat/[id]`, `/listener/chat/[id]`, `/mentor-profile/[id]`, `/mentor/member/[id]`, `/mentor/report`, `/mentor/helplines`, `/mentor/line`, `/mentor/[id]`, `/listener-apply`, `/journal/*`. `/listener` redirects to `/signin` **preserving the hash** (it must read `window.location.hash` itself — `<Redirect>` drops fragments). Removed in the cleanup step, except `/listener`, which stays until the founder confirms no old private links are in use.

### 4.5 Server link builders

Three call sites: `admin_console.py` (console link → `{app_base_url}/signin#token=`; new-admin link → `{admin_base_url}/admin#token=`) and `listener_applications.py` (approved-applicant console link → `/signin`). Ships **after** the app deploy that adds `/signin` (§5). Step 1 already routes all three builders through `app/services/links.py` on the app/admin origins (paths unchanged), so this step is a one-line path change there.

---

## 5. Rollout — each step ships alone

| # | Step | Touches | Prereq |
|---|---|---|---|
| 1 | **Domains + dynamic config** | `domains.env`, Nginx template + renderer, `deploy-web.sh`, CI workflow, API settings + prod env, certbot for `app.` + `admin.`, runbook | founder: `admin` A record |
| 2 | **App routes** — new routes, resolver, `/signin`, token-only `/mentoring`, merged `/apply`, legacy redirects, e2e URL updates | `apps/mobile` → web deploy + OTA | — |
| 3 | **Server links** → `/signin`, `admin.` | 3 call sites + tests → API deploy | step 2 live |
| 4 | **Cleanup** — delete `ListenerConsole.web`, `app/listener/*` (keep the `/listener` hash redirect), legacy redirects, `deploy-console.sh` wrapper; CLAUDE.md layout + conventions, `DEPLOYMENT_VPS.md`, DECISIONS §K entry | | steps 2–3 live; desktop spec's mentor workspace live |

Step 1 is reversible by re-rendering the previous conf (backups stay on the box as today). Nothing in steps 2–3 changes data.

## 6. Error handling

- Resolver `none`, expired/garbled sign-in links and unknown paths all end somewhere still and branded (`/`, the `/signin` card, `+not-found`) — never a blank screen, never a shake (T&S #11).
- A suspended mentor's token fails at the API exactly as today; `/mentoring` shows the existing session-lost state.
- Nginx: a missing `/_expo/` or `/assets/` file stays a real 404 (never the SPA shell).

## 7. Proof

- **Nginx:** the throwaway `nginx:1.22` container check used in session 34, run against the rendered template with three `server_name`s via `curl --resolve` — host map of §3.1 asserted row by row, including the 301 `Location` values.
- **pytest:** settings fallback (`console_base_url` only ⇒ both new URLs resolve to it), CORS origin derivation, the three link builders. `alembic check` untouched (no model change).
- **e2e (390×844, normal + reduced motion, 0 page errors):** new `legacy-routes.e2e.js` — every row of §4.4 lands on its new URL, `/listener#token=` signs in and lands on `/mentoring`; updated URLs in `listener-apply`, `member-screens`, `mentor-console`, `role-fork`, `two-party-chat`; `mentor-console` gains a token-only run (no member session on the device).
- **Live, after each deploy:** the `curl` host-map table + the read-only landing smoke (no prod user minted, no mentor pinged).

## 8. Open decisions (founder veto)

1. `/mentoring` as the name of the mentor's home.
2. Apex 302 → `app.` for now.
3. `/listener` hash redirect kept indefinitely until old private links are confirmed dead.
4. `app.` stays public and un-gated for members (ruling of 2026-09-19); `docs/PRIVACY.md` gains a line on the web surface before the URL is shared widely.
