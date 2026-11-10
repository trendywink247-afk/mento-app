# Role fork after landing — design

**Date:** 2026-09-04 · **Status:** approved by founder in session 30 (sections 1–6) · **Ruling:** `docs/DECISIONS.md` §K.7 (typeface: §K.6)

## Why

The founder wants a screen after the landing page that asks whether the person is here to talk (mentee) or to listen (mentor) and takes each to their own path. Today the app has no mentor-side surface on mobile beyond the application form and a status card on Profile; the console is web-only (DECISIONS §I.6). A native mentor console has been requested and will get its own spec; this spec only adds the fork and a Mentor Home that the future console can grow out of. Mentees must keep the 30-second promise: the fork costs them exactly one tap.

## Decisions taken (founder, 2026-09-04)

| Question | Answer |
|---|---|
| Placement | After "Start a Conversation", before the age gate. Remembered on device. Re-asked only after Start fresh. |
| Layout | **Two doors** — two stacked cards, talk door larger and warmer, companion hosting above. One tap advances. |
| Mentor destination today | A dedicated **Mentor Home** route (not the tab shell, not a fifth tab). |
| Integration | Role is **step zero of the existing onboarding journey** (step machine in `components/onboarding/OnboardingJourney.tsx`), not a separate route. |
| Wording | "mentor" everywhere (DECISIONS §K.1). "Mentors are real people, not therapists." on the fork. |

## 1. Flow and routing

```
Landing "Start a Conversation"
  └─ /onboarding  step machine
       role ──► age ──► email ──┬─► companion ──► ready ──► connecting ──► /chat/[id]   (mentee, unchanged)
                                 └─► primer ──► handoff ──► /mentor-home                (mentor, new)
```

- `ORDER` becomes role-dependent: `['role','age','email','companion','ready','connecting']` for mentee, `['role','age','email','primer','handoff']` for mentor. `BACKABLE` becomes `['role','age','email','companion','primer']`: back from `age` returns to `role`; back from `role` leaves the journey to the landing (existing `router.back()`); `handoff`, `ready` and `connecting` are not backable, as today.
- `?step=` deep links keep the current guard: any requested step other than `role`/`age` requires `dob` in the draft, else the machine resets to `role`. (Today it resets to `age`; the reset target moves one step earlier.)
- `app/index.tsx` redirect: session token present → read role → `mentor` ⇒ `router.replace('/mentor-home')`, otherwise `/chats` (today's behaviour). Missing role reads as mentee, so every existing install is unaffected.
- `app/start-fresh.tsx` clears the role with the session (same wipe).
- The legacy onboarding stub routes stay deleted (DECISIONS §K.3).

## 2. Role step ("two doors")

- Rendered inside `StepScaffold` like every other step: same aurora sky, same hosting companion (default panda until a companion is picked), same entrance primitives.
- Copy (EN canonical, HI mirrored in `locales/hi.json`):
  - Title: **What brings you here today?**
  - Sub: *No wrong answer. You can change this later.*
  - Door 1 (large, terracotta/accent tint): **I need to talk** — *Someone real, anonymous, in under a minute.*
  - Door 2 (smaller, secondary/sage tint): **I'm here to listen** — *Be the steady voice for someone else.*
  - Footer: *Mentors are real people, not therapists.*
- Tapping a door: `setDraft({ role })`, `saveRole(role)`, haptic `select` then `advance`, then `next()`. No Continue button.
- testIDs: `role-talk`, `role-listen`.
- Analytics: one new allowlisted event `role_chosen` with payload `{ role }` only. No PII, no free text.
- The door tiles use the existing `TiltCard` (2.5D) — door 1 at the standard tilt, door 2 at a lighter tilt. Under reduced motion both are flat.

## 3. Mentor path

### `primer` step
One screen, one button. Title **Listening here, in plain words.** Three short lines: you are a real person, not a therapist; you sit with someone in a hard moment; you never diagnose, and Mento shows the person helplines when it matters. Button **Continue to apply**. The pledge checkbox is *not* here — it stays on the application form where it is a hard gate.

### `handoff` step
Reuses the session-creation half of `ConnectingStep` (`api.startOnboarding({ dob, email })` → `saveSession`) with **no** `api.match` call and no companion. Staged copy: "Setting up your space…". On success: `router.replace('/mentor-home')`. If a session token already exists (returning mentor), it skips creation and replaces immediately. Errors: the same still, dimmed error state with a Retry as the connecting step; never shakes.

### Mentor Home — new route `app/mentor-home.tsx`
Outside the tab shell (pushed on the root stack, `headerShown: false`). Hero: the member's companion (default panda for mentors, since they never picked one) breathing at the shared tempo, title **Mentor Home**, persona name under it ("You appear as Golden Canyon").

State is driven by `api.getListenerApplication()`:

| State | Body |
|---|---|
| `null` (no application) | The shared `ApplicationForm` inline (same component the member flow and `/apply` use; testIDs unchanged). Submitting transitions to *pending* in place. |
| `pending` | Status card: **Application received** — *We read every application — hang tight.* |
| `approved` | Status card **You're a mentor now** + button **Open my mentor console →** (`Linking.openURL(console_url)`). Success haptic once on first render of this state. |
| `declined` | The existing 30-day copy; the form reappears only when the server allows a reapply. |

Every state has a quiet link **I'd rather talk today** (`testID="mentor-switch-talk"`): `saveRole('mentee')`, and because mentors never chose a companion, `saveCompanionAnimal(DEFAULT)` + `setCompanionColor(DEFAULT_COMPANION_COLOR)` first, then `router.replace('/chats')`. From Chats the person can start a General match like any member; Profile lets them change the companion later.

Profile's existing *Become a mentor* row is unchanged for mentees. The web console, the admin queue and every backend endpoint are untouched.

## 4. Persistence and API

- `lib/session.ts`: `saveRole(role: 'mentee' | 'mentor')`, `getRole(): Promise<'mentee' | 'mentor'>` (defaults to `mentee`), cleared in `clearSession()`. Key `mento.role`.
- `lib/onboardingDraft.ts`: `role?: 'mentee' | 'mentor'` on the draft.
- **No backend change.** `POST /onboarding/start` already accepts a missing companion; `POST /listener-applications` and `GET /listener-applications/me` are used as-is. Rate limits and the 30-day cooldown are unchanged.
- Role is a local preference, never sent to the server, never part of the persona. It cannot leak identity into the console or analytics.

## 5. Testing

- Existing e2e scripts that drive onboarding (`connecting-experience`, `member-screens`, `path-communities`, `hindi-core-loop`, `listener-apply`, `analytics-dark`, `two-party-chat`) get **one added line**: after `start`, tap `role-talk`. Nothing else in them changes.
- New `e2e/role-fork.e2e.js`:
  1. Landing → `role-listen` → age → email skip → primer → handoff → `/mentor-home` shows the inline form → fill + pledge + submit → pending card visible.
  2. `mentor-switch-talk` → `/chats` renders (tab bar present) with 0 page errors.
  3. New context reusing the stored session: load `/` → lands on `/mentor-home` directly.
  4. All of the above once more under `reducedMotion: 'reduce'`.
  Reset Redis + listener capacity before the suite (mento-e2e rule).
- `npx tsc --noEmit` remains the only JS gate.

## 6. Motion, haptics, reduced motion

- Role step uses `Entrance` + `StepTransition` with tokens from `theme/motion.ts`; transform and opacity only; no overshoot springs; ≤3 simultaneous movers (two doors + companion).
- Haptics from `lib/haptics.ts`: `select` on door press, `advance` on step change, `success` only on Mentor Home's approved state. Error states are still.
- Reduced motion: the step is a ≤150ms opacity fade, tilts off, companion frozen, Mentor Home hero static. Flow must complete fully with all motion stripped.

## Out of scope (own specs)

- **Native mentor console** (inbox, requests, online toggle, replies, push, in-app mentor auth). Mentor Home is designed as its future front door; nothing here presumes its shape.
- The visual fidelity pass (Baloo 2, Clay and Sage tokens, companion assets, chat immersion) — tracked in `PROGRESS.md` → revamp plan. The fork ships on today's tokens and is re-skinned with everything else.

## Open questions

None blocking. Two notes for the founder's veto (PROGRESS → Open): (a) mentors get the default panda companion silently; an alternative is to run the companion step for mentors too, at the cost of two extra screens before the form; (b) the primer is one screen — if legal wants the full pledge text there as well, it is a copy change only.
