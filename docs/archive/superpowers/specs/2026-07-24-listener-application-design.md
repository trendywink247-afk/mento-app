# Become a listener — in-app application → admin approval → console access

**Decision (founder, 2026-07-24):** members can apply from Profile to become a peer
listener. Staged for Module B: the form carries an optional "interested in paid
mentoring" flag, nothing else of Module B ships. Access delivery on approval:
**in-app status card always; email additionally when provided** (email *sending*
waits for an email provider — store now, send later; the in-app card is the
guaranteed path, same transparently-incomplete pattern as Razorpay).

**What this is:** a funnel into the existing listener system (DECISIONS §I.6) —
anonymous personas, admin vetting, web-only console via private token link.
**What this is not:** real profiles, verification (MSG91), payments, or a mentor
mobile app — all remain deferred Module B.

## Member experience (mobile)

- Profile gains a "Support others" row — *Become a listener* — between the
  coffee row and Start fresh. Warm, not recruity.
- Opens `app/listener-apply.tsx` (pushed route, not a tab): one screen, Calm
  register, StepScaffold-style layout:
  - Motivation: short free text ("Why do you want to listen?"), 40–500 chars.
  - Communities walked: multi-select chips from the existing path lenses
    (upsc / neet / jee / exams / life) — maps to `communities: list[str]`.
  - Availability: light chips (a few hours a week / most evenings / weekends /
    it varies) — a string enum, not a schedule.
  - Optional email (for the console link when we can send it).
  - Optional toggle: "I'd be interested in paid mentoring later" → `mentor_interest`.
  - Required acknowledgment: the listener pledge — "Listeners are not therapists.
    I'll listen, not diagnose; when someone needs clinical help I'll point them
    to it." (T&S rule 2 verbatim in spirit.)
- After submitting, the Profile row becomes a **status card**:
  - `pending` — "We read every application."
  - `approved` — reveals the private console link (opens in browser; console is
    web-only) + a short what-happens-next note.
  - `declined` — gentle copy, no reason shown, reapply allowed after 30 days.
- The application is tied to the anonymous persona/user id. No real names.

## Backend (services/api)

- New model `ListenerApplication` (`models/listener_application.py`):
  `user_id` (unique-open constraint), `motivation: str`, `communities: JSON`,
  `availability: str`, `email: str | None`, `mentor_interest: bool`,
  `status: ApplicationStatus` (pending/approved/declined), `decline_reason: str | None`
  (admin-only, never returned to the member), `listener_id: str | None` (set on
  approval), timestamps. One forward Alembic migration.
- Member endpoints (`routers/listener_applications.py`, member JWT auth):
  - `POST /listener-applications` — create; 409 if one is already open/approved;
    422 on pledge unchecked or motivation out of bounds; rate-limited 3/day per
    user (`app/ratelimit.py` pattern, fail-open-never-silent); declined + 30 days
    → allowed again.
  - `GET /listener-applications/me` — status for the Profile card; when
    `approved`, response includes `console_url` (issued fresh via the same
    `issue_listener_token` path the admin console-link endpoint uses).
- Admin endpoints (extend `routers/admin_console.py`, existing token auth + audit):
  - `GET /admin/applications?status=` — queue.
  - `POST /admin/applications/{id}/approve` — creates the `ListenerProfile`
    (persona from the applicant's existing persona; `community_slug` from their
    first community; `vetting_status=approved`), links `listener_id`, audit row.
    Reuses the exact create-listener path `POST /admin/listeners` uses today.
  - `POST /admin/applications/{id}/decline` — status + private reason, audit row.
- Email on approval: **stored, not sent** (no provider). A `# TODO(email-provider)`
  marker at the single call site; PROGRESS Open decisions gets the provider choice.

## Admin experience (web `/admin`)

- Listener-management tab gains an **Applications** section above the listener
  list: persona name, motivation, communities, availability, mentor-interest
  badge, age of application; Approve / Decline (reason required) inline.
- No new tab, no new auth, every action audited like the rest of the console.

## Trust & safety

- Applicants are 18+ by the existing server-side age gate.
- Decline reasons are internal only.
- PostHog: event counts only (`listener_application_submitted/approved/declined`),
  never application text or email.
- The pledge acknowledgment is stored with the application (bool + timestamp).
- Suspension story unchanged: approved-then-suspended listeners lose console
  access instantly via `vetting_status=suspended`.

## Testing (tested-before-merge list: this touches listener auth/scoping)

- pytest: lifecycle (apply → pending → approve → listener exists + working
  token; decline → reapply blocked until cooldown), one-open-application
  constraint, member sees only their own application, decline reason never in
  member payload, admin endpoints audit + require admin token, rate limit.
- e2e (`listener-apply.e2e.js`, 390×844, 0 page errors, reduced-motion pass):
  profile → apply form → submit → pending card; admin API approves; profile
  shows approved card with console link.

## Out of scope

Email sending, mentor real profiles, MSG91, payments, listener training
content, application editing after submit.
