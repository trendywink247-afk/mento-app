# Path (Communities) — spec

**Decision (founder, 2026-07-13):** ship a Path tab — the Pathfinder (companion-led
questions that help a user name where they are in life) is the door into a Community
(UPSC first; NEET/JEE/other exams/life as peers). Tab option B: Path replaces Mentors
in the bar (listeners live inside the Path home; the mentors screen stays routable).

**A community is a lens, not a feed.** No posting, no groups, no follower counts —
anonymity rails unchanged. A community tunes: matching preference, warm-up prompts,
journey-stage naming, seasonal support copy.

## Question tree (v1)

- Root: "What brings you here these days?"
  - "I'm preparing for an exam" → exam picker (UPSC / NEET / JEE / a different exam)
    - each exam → its stage question ("Where are you on the road?")
  - "Life feels heavy right now" → life/heavy_days
  - "I'm at a crossroads about my direction" → life/crossroads
  - "I just want someone to talk to" → life/open_door
- Stages are gently named ("Foundation days", "The wait after prelims") and carry
  3–4 warm-up prompts each ("I'm scared I chose the wrong optional").

## Architecture (v1 pragmatic call)

- Community/stage/prompt/seasonal config lives in **code** (`services/paths_data.py`,
  same convention as `personas_data.py`) — served via API so the client stays
  data-driven. A DB-backed Community table waits until admins need to edit live.
- `users.community_slug` + `users.journey_stage`; `listener_profiles.community_slug`
  (null = serves all communities). One forward migration.
- Matcher: community is a **soft preference** (pool is small — never strand a user):
  community+category > community > category > rest.
- Seasonal cards: month-day ranges per community (the emotional calendar), computed
  server-side; default card otherwise.

## API

- `GET /paths/tree` — pathfinder question tree (public config)
- `GET /paths/me` — current path state (community, stage, prompts, seasonal, online count)
- `PUT /paths/me` — choose/rechoose {community, stage} (validated against config)
- `DELETE /paths/me` — leave path (back to pathfinder)

## Definition of done

- pytest: tree shape, choose/persist/clear, validation, matcher community preference.
- tsc clean; Pathfinder → placement → Path home → prompt-tap → chat E2E on web.
- Reduced motion: pathfinder fully usable, opacity-only.
