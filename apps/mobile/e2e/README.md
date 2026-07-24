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
