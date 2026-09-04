# E2E scripts (Playwright, Expo web at 390x844)

Prereqs: backend on :8000 (seeded), Expo web on :8081.

Run:  NODE_PATH=<playwright install>/node_modules node e2e/<script>.js

- path-communities.e2e.js — Pathfinder walk → UPSC placement → Path home →
  prompt pre-fills chat composer (never auto-sent) → re-path → reduced-motion run.
- connecting-experience.e2e.js — searching story (staged copy + card carousel) →
  found crescendo (persona card) → chat. 0 page errors.
- listener-apply.e2e.js — profile → become-a-listener application → pending card;
  with MENTO_ADMIN_TOKEN also admin approve → approved card + console link.
  Normal + reduced-motion runs, 0 page errors.
- apply.e2e.js — public /apply landing page (no app install/session needed):
  underage DOB blocked (continue stays disabled) → valid adult DOB mints a
  throwaway anonymous member via onboarding/start → application form → submit
  → success panel. Normal + reduced-motion + a 1280x800 desktop smoke pass.
  With MENTO_ADMIN_TOKEN also proves the admin queue resolves the throwaway
  user correctly (approve succeeds). 0 page errors.
