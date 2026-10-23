# Backend audit — 2026-09-19

Scope: everything under `services/api` (app, migrations, scripts, tests, compose, Dockerfile),
`deploy/`, `.github/workflows/api-ci.yml`. Read against `CLAUDE.md` (Trust & Safety, conventions,
test-before-merge list). Baseline before any change: `255 passed`, `alembic check` clean, head
`61e06b08d4df`.

Severity: **S1** data loss / safety / security · **S2** reliability under load or failure ·
**S3** correctness edge · **S4** organisation and maintainability.

Status legend (filled in at the end of the session): **fixed** (commit) · **planned** (written
plan below, not built) · **won't fix** (with the reason).

Line numbers are as of commit `a9bff53` (before this session's changes).

---

## Status at the end of the session

Suite: **255 → 309 passed**, `alembic check` clean, ruff + black clean (the CI lint job was
red on master before — fixed in `df31bf6`), **no migration added**, no response shape changed
except additively (the schemas move is proven by a byte-identical OpenAPI document).

| # | Sev | Finding | Status |
|---|---|---|---|
| F1 | S1 | DB fault strips the helpline card from a crisis message | **fixed** `2e813f0` |
| F2 | S1 | Gemini key + message text can reach logs / Sentry | **fixed** `55075b9` (+ `hide_parameters` in `6ed8bcc`) |
| F3 | S1 | Report / Block / Suspend never reach Stream | **fixed** `b496eda` — freeze verified live against the dev Stream app; token revocation **planned** (P2) |
| F4 | S1 | Personal request accepted twice / by a suspended or blocked mentor | **fixed** `f40b0e9` |
| F5 | S2 | Counter drift: Report / Block unlocked (turned out to be a **deadlock** too) | **fixed** `b496eda` |
| F6 | S2 | Counter drift: reconcile recount races the matcher | **fixed** `68b5cee` |
| F7 | S2 | Counter drift: crash between match phases leaks a slot for 24 h | **fixed** `68b5cee` |
| F8 | S2 | Stale sweep ends live chats by age, not silence | **planned** (P1) — needs a migration + a founder window |
| F9 | S2 | Rate-limit gaps (scan, organize, requests, journal writes) | **fixed** `b408c66` |
| F10 | S2 | No request id / access line / JSON 500 / readiness | **fixed** `6ed8bcc` |
| F11 | S2 | Onboarding orphans a user when Stream is down | **fixed** `9372dd0` |
| F12 | S2 | `TRUSTED_PROXY_HOPS=0` behind a proxy = one shared bucket | **fixed** `6ed8bcc` (startup warning) |
| F13 | S3 | Check-then-insert races (reflection 500s, 6× duplicate requests) | **fixed** `9372dd0` |
| F14 | S3 | Unbounded / mis-ordered lists, admin N+1, page-bound "Saved N" | **fixed** `9055897` |
| F15 | S3 | Signed-but-malformed webhook body → 500 | **fixed** `2e813f0` |
| F16 | S3 | Companion animal / colour are free strings | **fixed** `72ad53e` |
| F17 | S4 | Routers importing routers' and services' privates; end logic ×4 | **fixed** `b496eda`, `a8fd2d6` |
| F18 | S4 | 549-line `schemas.py` | **fixed** `a32e240` |
| F19 | S4 | Redis client reached into from six modules | **planned** (P4b) |
| F20 | S4 | No foreign keys | **planned** (P3) |
| F21 | S4 | pytest TRUNCATEs the developer's database | **planned** (P5) |
| F22 | S4 | Test-before-merge gaps | **fixed** for every finding above (54 new tests); dependency audit in CI **planned** |
| F23 | S4 | `python-jose` unmaintained | **planned** |
| F24 | — | Start fresh erases nothing server-side | **fixed** — `DELETE /me` (`services/erasure.py`, DECISIONS §L.11); FKs (F20) still planned |
| F25 | — | Clean Wipe leaves Mentor-Note copies | **founder ruling needed** |
| F26 | — | Full DOB stored | **founder ruling needed** |
| F27 | — | Push token can be re-pointed by anyone who knows it | **won't fix** — unguessable, and it is what makes reinstall work |

## What is already good (do not regress)

- Crisis scan is enforced server-to-server in the Stream before-send hook, signature-verified,
  deduped by a unique index on `safety_flags.stream_message_id`, with a retried async net.
- The matcher's three-phase `open_conversation` never holds a row lock across the Stream HTTP
  call, and compensates on Stream failure. End / wipe / mentor-end take a row lock and release
  the slot with an atomic guarded `UPDATE`.
- Every conversation / journal / request / application / push-token endpoint scopes by the
  caller's id and answers an opaque 404 for someone else's row (checked endpoint by endpoint —
  no cross-tenant read or write found). Admin and listener revocation is a per-request DB check.
- Admin tokens have their own secret; role claims are checked on every dependency; outside dev
  the API refuses to boot with default secrets, no Stream creds, or an empty CORS list.
- Rate limiter is atomic (INCR + EXPIRE NX), fail-open with a warning, fail-closed for the PIN.
- Push bodies are a closed template set; logs carry exception *types*, never ids or text.

---

## Ranked findings

### S1

**F1 — A database hiccup strips the helpline card from a crisis message.**
`app/routers/stream_hooks.py:123-150,165-167`. `_scan_event` opens a DB session and looks the
conversation up *before* scanning, for every message. Input: member sends "I want to die" while
Postgres is restarting / the pool is exhausted (`db_pool_timeout=5`). `_run_scan` raises → the
hook answers 500 → Stream fails open and delivers the message **with no `crisis` payload** — the
member never sees Tele-MANAS / KIRAN. The async `message.new` net later writes the flag for the
human queue, but it cannot add the card to a delivered message. Also: every ordinary message
costs a DB round trip on the hottest path in the product.
Fix: run the pure lexical scan first; touch the DB only when a signal fired; if persisting the
flag fails, log loudly and **still return the crisis augmentation** (the retried async webhook
persists the flag). Blast radius: `stream_hooks.py` only; response shape unchanged.

**F2 — Secrets and message text can reach logs and Sentry.**
(a) `app/services/notes_ai.py:70-75` sends the Gemini key as `?key=` — `httpx` logs every request
URL at INFO and `app/main.py:30` sets the root logger to INFO, so the key is written to the
container log on every organize call; Sentry's httpx breadcrumbs carry the same URL.
(b) `app/main.py:45-51` strips request bodies but leaves Sentry's default
`include_local_variables=True`: an exception inside `_scan_event(text=…)`, `moderation.redact(text)`
or `save_mentor_note(payload)` ships the frame locals — the **message text** — to Sentry
(T&S #10).
Fix: key in the `x-goog-api-key` header; `httpx`/`httpcore` loggers to WARNING;
`include_local_variables=False`, `max_request_body_size="never"`, drop query strings and cookies
in `before_send`. Blast radius: config only.

**F3 — Report, Block and Suspend never reach Stream: a blocked or suspended mentor can keep
writing to the member.**
`app/routers/conversation.py:299-347`, `app/routers/admin_console.py:284-296`. All three only
change Postgres. The Stream channel stays open and the listener's Stream token never expires and
is never revoked, so a mentor the member has just blocked — or one the team has suspended for
cause — can still send into the channel from a client that is already open (or from a saved
token). Push is suppressed for a non-active conversation, but the message still lands in the
chat. Suspend additionally leaves the mentor's active conversations `active`: slots held, members
waiting on someone who can no longer open the console.
Fix: freeze the Stream channel (server-side `frozen: true`, which ordinary members cannot undo)
on member Report / Block and on Suspend; Suspend also ends the mentor's active conversations as
`system` and releases their slots. Freeze is best-effort and **never silent** (warning log) — a
Stream outage must not stop a report from being filed. Plain End is deliberately *not* frozen:
the client keeps the composer live on ended chats today and the founder's async direction may
rely on that (see Judgement calls). Token revocation is planned, not built (it needs `iat` on
every Stream token we mint and care over clock skew). Blast radius: new `services/conversations.py`,
`stream.freeze_channel`, three routers.

**F4 — A Personal request can be accepted twice, by a suspended mentor, or for a member who
has since blocked that mentor.**
`app/services/matching.py:254-301`. `_pending_request` reads the request with no lock; two
concurrent accepts (double tap, or admin + mentor) both see `pending`, serialise on the listener
lock, and the second — holding a stale `pending` in its session — opens a **second conversation
and takes a second slot** for the same request. The path also never checks
`vetting_status == approved` (admin stand-in can open a chat for a suspended mentor) or the
member's block list (block after request → the blocked mentor accepts and is back in the
member's chats; T&S #9).
Fix: lock the request row (`FOR UPDATE`, lock order request → listener), re-check status under
the lock, require an approved listener, refuse when the requester has blocked the target (the
request is closed as `declined`). Blast radius: `matching.py`; callers unchanged.

### S2

**F5 — Counter drift, source 1: member Report / Block do not lock the conversation.**
`app/routers/conversation.py:329,344` call `_owned(...)` without `lock=True`, unlike End / Wipe.
A report racing the mentor's End (or a double-tapped report) sees `active` twice and calls
`release_listener_slot` twice → the counter drifts **low**, and the matcher over-assigns past
`max_concurrent`. Writing the test showed it is worse: the report path takes listener row →
conversation row, the mentor End takes conversation → listener, and Postgres answers
`DeadlockDetected` — one of the two callers gets a 500. Fix: lock the conversation first,
everywhere, through one helper (`services/conversations.py`).

**F6 — Counter drift, source 2: the reconcile recount races the matcher.**
`app/services/matching.py:344-360`. `UPDATE listener_profiles SET active = (SELECT count…)` under
READ COMMITTED: if a matcher holds the listener row, the UPDATE waits, then re-checks the row but
evaluates the sub-select on its **original snapshot** — the conversation the matcher just
committed is not counted and the counter is written one low. This runs inline from
`match_general` whenever the pool looks full — exactly when matchers are busiest.
Proven before the fix: counter 2, real 3.
Fix (as built): reconcile takes the listener rows it can get **without waiting**
(`FOR UPDATE SKIP LOCKED`, id order) and sweeps + recounts only those, so the recount's snapshot
is taken when no reservation on the row can be in flight — and the matcher still never blocks
(`test_matcher_skips_a_locked_listener_row` forbids it). A row a matcher holds is healed on the
next pass. `match_general` now retries its pick after a heal regardless of the counts, because
another member's heal may be the one that freed the slot.

**F7 — Counter drift, source 3: a crash between `open_conversation` phases leaks a slot for 24 h.**
`matching.py:151-191`. Phase 1 commits the reservation; if the process dies before phase 3 the
conversation is `active` with `stream_channel_id IS NULL` and holds a slot until the 24-hour
sweep. Fix: reconcile also ends channel-less active conversations older than two minutes.

*Dev-DB note:* the counters that disagree with reality on this machine (0 vs 22 / 15 / 23 real
active rows, measured before this session) come from the e2e reset
`UPDATE listener_profiles SET active_conversations = 0` while specs never End their chats — not
from F5–F7. The code paths above are the production drift sources.

**F8 — The stale sweep ends live conversations by age, not by silence.**
`matching.py:329-342` ends anything `created_at < now − 24 h`, even a chat with a message a
minute ago. With the founder's async direction (mentors answer when free) a two-day-old thread is
normal; once swept, `push.notify_message` suppresses every notification as `not_active`, so the
thread silently stops notifying both sides. **Planned** (needs a `last_message_at` column stamped
by the `message.new` webhook + a founder ruling on the window) — see Plans §P1.

**F9 — Rate-limit coverage gaps on endpoints that cost money, mentor attention or reviewer time.**
- `POST /safety/scan` (`routers/safety.py:24`): no limit, no dedupe key → one member can write
  thousands of unreviewed crisis flags and bury real ones in the Safety queue.
- `POST /journals/organize` (`routers/journals.py:151`): no limit → unbounded paid Gemini calls,
  each pinning a worker thread for up to 20 s.
- `POST /listeners/{id}/request` (`routers/listeners.py:202`): no limit → a member can page every
  mentor's phone (one push per new pair).
- `POST /journals/entries`, `POST /journals/mentor-notes`: no limit → 4 KB rows without bound.
Fix: per-user windows (scan 30/10 min, organize 5/h, requests 10/h, journal writes 120/h),
fail-open like the rest.

**F10 — No request id, no access line, plain-text 500s, no readiness probe.**
`app/main.py`. Nothing ties a member's error to a log line; an unhandled exception returns
Starlette's `text/plain` "Internal Server Error" (the app parses JSON `detail`); `/health` is
static, so the container reports healthy with Postgres down.
Fix: middleware that accepts/mints `X-Request-ID`, returns it, and logs one structured line per
request (method, route path, status, ms, request id — never query strings, bodies or tokens);
JSON 500 handler `{"detail", "request_id"}`; `GET /health/ready` (DB required, Redis and Stream
reported). Blast radius: additive.

**F11 — Onboarding orphans a user when Stream is down.**
`routers/onboarding.py:67-75`. The user row is committed, then `stream.upsert_user` raises → 500.
The member retries → a second user; each retry burns one of 10 hourly IP slots. Fix: compensate
(delete the row) and answer an honest 503.

**F12 — Behind nginx with `TRUSTED_PROXY_HOPS=0`, every member shares one rate-limit bucket.**
`ratelimit.py:93-115` is correct, and `docs/DEPLOYMENT_VPS.md` says to set `1`; but nothing checks
it. Forgetting it in prod means the 11th new member per hour, worldwide, gets 429 on onboarding.
Fix: loud startup warning outside dev when it is 0.

### S3

**F13 — Check-then-insert races that surface as 500s or duplicates.**
- `conversation.py:286-294` reflection: two submits → `IntegrityError` → 500.
- `services/push.py:38-63` `upsert_token`: same, on `uq_push_token_value_kind`.
- `journals.py:55-84` mentor note: no unique key → a double long-press saves the note twice.
- `listeners.py:219-241` personal request: two pending rows for one pair, two pushes.
Fix: catch-and-retry on the two with a unique key; serialise the other two per user with the
`SELECT user FOR UPDATE` idiom `listener_applications.apply` already uses.

**F14 — Unbounded or mis-ordered lists; one N+1.**
- `listener_console.py:236-261` returns a mentor's whole history, unbounded, and sorts
  active-first in Python *after* the SQL ordering — adding a limit naively would cut old active
  chats. `listeners.py:244-254` (`requests/mine`) unbounded.
- `journals.py:198-216`: mentor notes default 100 / max 200; the chat header's "Saved N" counts
  the list client-side, so it is wrong past the page. No per-conversation filter or count.
- `admin_console.py:165-186`: three `db.get` per flag × 200 flags.
Fix: SQL ordering (active first, newest) + `limit`; `conversation_id` filter and a count
endpoint for mentor notes; batch-load the admin flags.

**F15 — Webhook body that is not JSON → 500.** `stream_hooks.py:113-117`. Signed-but-malformed
is unlikely, but a 500 on the async hook makes Stream retry forever. Fix: 400.

**F16 — `companion_animal` / `companion_colour` are free strings.** `schemas.py:18-19`. Checked:
the server accepts **Dog, Cat and Capybara** today (nothing validates) — the shipped picker is not
broken. But anything ≤ 32 chars is stored and later shown to the mentor in the member brief.
Fix: one allowed set (`services/companions.py`); onboarding *coerces* unknown values to NULL
(never rejects — an old build with a retired colour name must still get in); the new
`PUT /me/companion` validates strictly.

### S4

**F17 — Layering.** `routers/conversation.py:24` imports `_profile_out` from another *router*;
`routers/listeners.py:37-38` imports underscore-private helpers from `services/matching`; end-of-
conversation logic is written out four times (member end, wipe, report/block, mentor end).
Fix: `services/listener_profiles.py`, public names in `matching`, one `services/conversations.py`.

**F18 — `schemas.py` was 549 lines / 70 models in one file.** Now a package by surface,
re-exporting every name from `app.schemas` so no import changed (OpenAPI byte-identical).

**F19 — Redis client lives in `ratelimit._redis` and is reached into from six modules** for
things that are not rate limiting (webhook stamp, watcher cache, brief cache, redaction counters).
Tests reach into it too. **Planned** — §P4.

**F20 — No foreign keys** (only `favourite_listeners`). Orphans are possible by construction
(`conversations.user_id`, `journal_entries.user_id`, …). **Planned** — §P3, together with erasure.

**F21 — pytest runs against, and TRUNCATEs, the developer's database** (`tests/conftest.py:80-89`)
— every run wipes dev conversations and forces the re-seed ritual; a mistyped `DATABASE_URL`
would do the same to a real database. **Planned** — §P5.

**F22 — Test-before-merge gaps.** Covered: matching, routing, crisis scan, age gate, paths,
listener console, admin auth. Missing before this session: accept double-submit, report-vs-end
race, reconcile-vs-matcher race, crisis hook under DB failure, rate limits on scan/organize.
Payments has no tests because there is no payments code yet. CI has no dependency audit.

**F23 — `python-jose 3.3.0`** carries CVE-2024-33663/-33664. Not exploitable here (HS256 only,
`algorithms` pinned, no JWE) but it is unmaintained. **Planned**: move to PyJWT in one commit with
the security tests as the net.

### Privacy / honesty findings that need a founder ruling (not code-fixable alone)

**F24 — "Start fresh" erases nothing on the server** except the push token: the user row (full
DOB, optional email), journals, conversations and favourites stay forever. The copy ("leave this
persona behind") does not claim deletion, so it is honest — but there is no erasure path at all.
**Planned** — §P3.

**F25 — Clean Wipe leaves copies of the mentor's messages in `journal_entries`** when the member
had saved them to Mentor Notes (`meta.conversation_id` links them). The wipe promise is "from your
device and our servers". They are the member's own deliberate keepsakes, so deleting them silently
is also wrong. Needs a ruling: keep (and say so in the wipe sheet) or delete with the wipe.

**F26 — `users.dob` stores the full date** though only "18+" is ever needed after the gate.
Storing `age_at_signup` + birth *year* would honour T&S #6 better. Needs a ruling + migration.

**F27 — Anyone holding another device's Expo push token can re-point it** (`push.upsert_token`
re-owns an existing row). Tokens are unguessable and the behaviour is what makes reinstall work.
**Won't fix.**

---

## Plans for what is not built this session

**P1 — Staleness by silence (F8).** Migration: `conversations.last_message_at timestamptz NULL`.
`stream_hooks.push_webhook` stamps it (one `UPDATE … WHERE stream_channel_id = :cid`, inside the
existing worker thread, best-effort). Reconcile uses `coalesce(last_message_at, created_at)`.
Founder picks the window (suggest 7 days for async). Test: a 3-day-old chat with a message
yesterday survives reconcile.

**P2 — Stream token revocation on suspend (F3).** Mint every Stream token with `iat` (and a
30-second back-date for clock skew), then `client.revoke_user_token(listener_id, now)` on suspend.
Needs a live check against the dev Stream app that existing iat-less tokens keep working until
revoked.

**P3 — Erasure + foreign keys (F20, F24).** `DELETE /me`: wipe every Stream channel the member
owns, hard-delete journals, favourites, push tokens, reflections, requests; anonymise (not delete)
conversations, moderation events and safety flags — the mentor's history and the safety record
must survive; delete the Stream user. Then add FKs with `ON DELETE` rules that match. Two
migrations, one spec, founder sign-off on what "begin again" promises.

**P4 — Organisation.** (a) ~~`app/schemas/` package~~ — done. (b)
`app/cache.py` owning the Redis client and the four non-limiter uses; `ratelimit._redis` stays as
an alias until tests move. (c) routers hold no `select(...)`: move the remaining query code in
`listener_console.py` and `admin_console.py` into services, one router per commit.

**P5 — A test database (F21).** `conftest.py` derives `<db>_test` from `DATABASE_URL`, creates it
if missing, sets the env var before `app` is imported; CI unchanged. Removes the re-seed ritual.

**P6 — nginx body limit.** `deploy/nginx/mento-api.conf.template` allows 5 MB bodies; nothing in
the API takes more than ~5 KB. Set `client_max_body_size 64k` (outside this session's paths).

---

## Judgement calls for founder veto

1. Report / Block / Suspend now **freeze** the Stream channel — nobody can write in it again,
   including the member. Plain End does not (the app keeps the composer live on ended chats).
2. Suspending a mentor now **ends their active conversations** (as `system`) and frees the slots.
3. A Personal request whose member has since blocked the mentor is closed as `declined` when the
   mentor tries to accept it.
4. Onboarding stores NULL for an unknown companion animal or colour instead of the raw string.
5. New per-member limits: crisis self-scan 30 / 10 min, note-sorting 5 / h, Personal requests
   10 / h, journal writes 120 / h, companion change 30 / h.
6. Onboarding answers **503 and removes the account** when Stream cannot register the member,
   instead of leaving a member who can never be put in a channel.
7. The capacity sweep now also ends an `active` conversation that has had **no Stream channel
   for two minutes** (a crashed match) — before, it held a mentor's seat for 24 h.
