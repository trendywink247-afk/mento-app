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
- mentor-console.e2e.js — REQUIRES MENTO_ADMIN_TOKEN. Mentor: role fork → apply →
  admin approve via API → Mentor Home IS the console → online. Member (2nd context):
  onboards → sends a Personal request. Mentor: accept → chat → mentor rail → reply;
  member sees it; Report sheet files; End frees the seat (row shows Ended).
  Reduced-motion pass reopens the console. 0 page errors in every context.
- notifications-route.test.mjs — NOT a browser spec: a Node unit test of the pure
  notification-tap router (`lib/notificationRoute.ts`). Run `npm run test:route`.
- connecting-busy.e2e.js — flips every seeded listener to away (docker exec), drives
  onboarding into the honest-busy retries, and asserts the error state offers Try again
  AND "Browse mentors instead", which lands on the Mentors screen inside the app.
  Restores listeners to online afterwards. Normal + reduced-motion, 0 page errors.
- mentor-profile.e2e.js — "Two in the room" (spec 2026-09-06-chat-profiles-composer-
  design.md §3): onboard → chat → tap the mentor header → profile screen (persona name
  from route params first, then the fetched profile) → favourite toggle flips to
  "Saved" → back to the still-live chat → Browse shows the favourite first with a heart
  badge. Resets rate limits + capacity accounting (docker exec) before each run and
  retries once on a 503/429/missing-listener flake. Normal + reduced-motion, 0 page
  errors.
- chat-header.e2e.js — the member chat's header card + "In this chat" strip (DECISIONS
  §L.8): mentor name + "here now" with the presence ring/dot; no strip while nothing is
  kept; a mentor note seeded for THIS conversation → back in the chat → "Saved 1" (a note
  from another conversation is not counted); identity area → mentor profile → back; the
  mentor flipped to away (docker exec, restored in `finally`) → "Mentor · away", no ring,
  no dot. `SHOT=<path>` writes a screenshot. Normal + reduced-motion, 0 page errors. The
  live save-from-message tick-up is asserted in two-party-chat.e2e.js.
