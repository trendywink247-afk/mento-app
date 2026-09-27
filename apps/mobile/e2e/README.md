# E2E scripts (Playwright, Expo web at 390x844)

Prereqs: backend on :8000 (seeded), Expo web on :8081.

Run:  NODE_PATH=<playwright install>/node_modules node e2e/<script>.js

- path-communities.e2e.js — Pathfinder walk → UPSC placement → Path home →
  prompt → first-question builder → continue → pre-fills chat composer (never
  auto-sent) → re-path → reduced-motion run.
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
- session-refresh.e2e.js — refreshing sessions (WS3 T3.2), on Journals so it needs no
  Stream: (A) a pre-refresh install (long-lived token only) loads and upgrades silently,
  its old token still valid; (B) a stale access token is refreshed and the call retried;
  (C) /auth/refresh unreachable → still signed in, tokens untouched; (D) a dead refresh
  family → the old sign-out to the landing. Normal + reduced-motion, 0 page errors.
- admin-read-scope.e2e.js — REQUIRES ADMIN_TOKEN. Scoped admin reads (WS3 T3.12): a flagged
  conversation opens from the Safety panel only after a stated reason (8+ chars, sent to
  the server and kept in the audit trail); the API refuses no reason (422) and a chat with
  no open flag/report (403 `no_open_case`). Normal + reduced-motion, 0 page errors.
- console-code.e2e.js — REQUIRES ADMIN_TOKEN. One-time mentor console links (WS3 T3.10):
  the status poll carries no token; an approved mentor's `#code=` link opens the web
  console once (fragment stripped) and the same link again shows "expired or was already
  used". Normal + reduced-motion, 0 page errors.
- age-gate-friction.e2e.js — the /apply age step (WS3 T3.8): no passing default (Continue
  disabled on arrival, limit line only after a touch); a refusal remembered on the device
  holds for an adult year; the server's per-install cooldown (403 age_gate_cooldown) shows
  the refused line and is remembered. Needs rate limits ON. Spends 2 under-age refusals per
  run from your address — 3 in a day cool the ADDRESS down too: clear `agegate:*` in Redis
  between runs. Normal + reduced-motion, 0 page errors.
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
- path-question.e2e.js — the first-question builder (DECISIONS §L.8): a Path starter opens
  the builder (no match on the tap); chips change the live preview deterministically;
  "Another" cycles the path's starters; BOTH actions reach the chat with the assembled
  text IN the composer and nothing sent (transcript still empty, re-checked 2 s later) —
  "Edit in chat" also arrives with the composer focused, caret at the end; the Life path
  is never offered exam chips; past 160 characters the last clause is dropped whole with
  an honest note. `SHOT=` / `SHOT_CHAT=` write screenshots. Normal + reduced-motion, 0
  page errors.
- question-builder.test.mjs — NOT a browser spec: a Node unit test of the pure sentence
  assembly + chip rules (`lib/questionBuilder.ts`). Run `npm run test:question`.
- companion-placement.e2e.js — the companion finds a new place on every screen
  (`lib/companionPlacement.ts` + `components/art/PerchedCompanion.tsx`): onboards as a FOX →
  chat has ONE fixed slot (`composerTop`), not drawn under the options sheet → each of the
  four tabs shows exactly one `companion-slot-*`, drawing decoded Fox art, never a cling
  pose → back and forth lands on ≥2 slots per screen, never the same twice running → it
  stays put between arrivals and breathes (breathing OFF under reduced motion, placement
  kept) → Profile recolour reaches the account (GET /me) → a My Chats load error holds the
  home slot in the sit pose → the same member as a CAT takes a cling slot (hang / peek /
  dangle) within 14 arrivals. The slot id is the testID suffix; the animal + pose are on
  the nested `companion-art-<Animal>-<pose>`. Dev builds can pin a slot to look at it:
  `window.__MENTO_PERCH__ = { journal: 'todayHang' }` before load. One onboarding for both
  passes (the reduced pass reuses the storage state). Normal + reduced-motion, 0 page errors.
- companion-placement.test.mjs — NOT a browser spec: 2,000 simulated arrivals per animal,
  day and night, over the pure picker (never the previous slot, never a slot the animal has
  no art for, naps only at night, deterministic per seed, personality shows in the counts,
  still states hold home). Run `npm run test:placement`.
