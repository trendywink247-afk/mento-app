# Mento — Pre-Launch Status & Checklist

> Compiled 2026-07-20 from a live stand-up of the stack (Docker Postgres 16 + Redis 7,
> FastAPI uvicorn :8000, Expo web :8081) and a read of CLAUDE.md / DECISIONS.md / PROGRESS.md.
> Every "verified" item below was actually run, not inferred.

## 1. What actually runs right now (verified live)

| Check | Command | Result |
|---|---|---|
| Backend migrations in sync | `alembic upgrade head` + `alembic check` | ✅ "No new upgrade operations detected" |
| Test suite | `pytest -q` | ✅ **54 passed** (17.08s, 11 files) |
| Type gate (mobile) | `tsc --noEmit` | ✅ exit 0, 0 errors |
| API health | `GET /api/v1/health` | ✅ `{"status":"ok"}` |
| Expo web | `GET :8081` | ✅ 200 |
| E2E — Path/Communities | `node e2e/path-communities.e2e.js` | ✅ 0 page errors |
| E2E — Connecting experience | `node e2e/connecting-experience.e2e.js` | ✅ 0 page errors |

**Verdict on current code state: the web test surface is green end-to-end.** The 30-second
onboarding→chat promise, the Path tab, and the connecting crescendo all execute with zero
console/page errors against a real backend + Stream-stub.

## 2. OPEN LAUNCH GATES (must close before a real user faces this)

Ordered by legal/risk weight, not effort.

### A. Legal / Trust & Safety (hard gates)
- [ ] **Privacy policy must disclose safety-staff conversation access.** The admin dashboard's
      live read-only conversation view makes this a real data flow now (PROGRESS §16). This is a
      launch blocker per CLAUDE.md T&S #6.
- [ ] **Privacy policy must disclose Path community + journey-stage data** (coarse, self-declared,
      clearable — but it IS collected; note it).
- [ ] **Helpline re-verify before launch.** Tele-MANAS 14416 / KIRAN 1800-599-0019 are
      hardcoded in the crisis card. Confirm both are current India numbers. (Carried since session 6.)
- [ ] **Under-18 exclusion** — confirm with CA that the 18+ server-side gate is the intended
      MVP posture (DECISIONS §G still lists it as open).
- [ ] **AI-generated mascot license clearance.** The companion art (session 13) was made on a
      Higgsfield free plan — verify commercial-use terms before App Store / Play Store submission.
      Note lives in `docs/mascot-candidates/README.md`.

### B. Documentation truth (blocks "we know what we shipped")
- [ ] **DECISIONS.md needs §J.** Communities-as-lens + the Chats·Path·Journals·Profile tab swap
      shipped in session 17 *ahead of the doc* on founder instruction. The doc still jumps §I → end.
      Reconcile so the authoritative reconciliation file matches reality.
- [ ] **"Docs drift to reconcile" (CLAUDE.md §) — clear the three lines** once §J lands.

### C. Infrastructure / vendor (cost + reliability)
- [ ] **Razorpay creds** — coffee/tip screen ships transparently disabled. Wire + receipt before
      the contribution feature is meaningful.
- [ ] **Stream webhook URL** — currently an ephemeral cloudflared tunnel per session. Needs a
      stable URL for staging/prod, and **Stream secret rotation** (a secret was pasted in chat,
      session 6 — confirm it was rotated).
- [ ] **Prod runbook** — multi-worker + proxy gzip; the API refuses to boot on default JWT_SECRET
      outside dev (good), but the deploy story is unwritten.
- [ ] **Prod env vars from session 19** — set `ADMIN_JWT_SECRET` (dedicated admin signing key)
      and explicit `CORS_ORIGINS` (comma-separated console origins). Both have safe fallbacks but
      prod should be explicit. See `.env.example`.

### D. The biggest UNMEASURED risk — native mobile
- [ ] **Android release perf gate NOT run.** No device/emulator verification this project's history.
      Skia aurora shader + Lottie + 2.5D Tilt3D parallax + 60fps-mid-Android is an *unverified*
      performance bet. Concrete action:
      `npx expo run:android --variant release` → `adb shell dumpsys gfxinfo` through a full
      onboarding pass; record frame time / jank; APK size check (<40MB incl. Skia ~3–5MB).
      Contingency already documented in `AuroraCanvas` (half-res canvas + scale(2)).
- [ ] **Maestro native verification** of: stream-chat-expo UI, the options sheet, haptics
      vocabulary, keypad, transformOrigin under motion. Web is NOT the deliverable.
- [ ] **iOS verification** — same surfaces; native-only build path.

### E. Analytics / observability
- [ ] **PostHog funnel** wired (never message content or PII; crisis sessions excluded from
      retention metrics — enforce in code, not just config).
- [ ] **Sentry / crash-free-session tracking** — the >99.5% crash-free target is unmeasured
      without it.
- [ ] **Uptime monitor on `GET /health/crisis`** (session 19). Returns 503 when Stream is
      configured but no webhook has arrived in 30 min, or Redis is down — i.e. the crisis-scan
      pipeline is silently dead. Without a monitor pointed at it, nothing pages. Launch gate.
- [ ] **Hindi core loop** — first community is UPSC (Hindi-heavy audience); i18n for the core
      flow is on the H1 horizon but not done.

## 3. Engineering hygiene nits (not blockers, but real)
- [ ] **ruff/black claimed in conventions but not configured/enforced** (PROGRESS §18). Either add
      to CI or drop the claim from CLAUDE.md.
- [ ] **Lottie art does not follow the companion accent** — accepted trade-off, but ratify the
      yes/no so it's a decision, not drift.
- [ ] **`datetime.utcnow()` deprecation** in `jose/jwt.py` — harmless warning today, fix before
      a Python upgrade bites.

## 4. Bottom line
The **web build is launch-quality for a demo/tester cohort**. The product's soul — anonymous,
<30s, safe — is real and proven. The gap to "ship to real users on phones" is:
**(1)** close the four legal/privacy docs, **(2)** run the Android release perf gate (the one
thing that could silently fail on the actual deliverable), **(3)** stabilize Stream/Razorpay infra,
**(4)** reconcile DECISIONS §J. None are research problems; they're execution + a device.
