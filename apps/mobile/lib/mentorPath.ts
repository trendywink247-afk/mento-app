/**
 * The mentor path — ONE state machine for every door into the mentor side (founder,
 * 2026-09-19: "sort all the navigations and make it a unified experience"; DECISIONS §L.12).
 *
 * The state is the SERVER's (`GET /listener-applications/me`), never a device switch:
 *
 *   none      → the loop: the story (A38) → [age gate, visitors only] → the primer (A33)
 *               → the application (A37) → In review
 *   review    → In review (A37) — "already applied"
 *   declined  → the calm note + the cooldown truth (the server's `reapply_after`) → the
 *               application again once the month has passed
 *   approved  → Mentor Home (A10), no form, no primer again
 *
 * The doors — Profile's mentor row, the role fork's "I want to mentor" (after age + email),
 * the public `/apply` page, Mentor Home itself, a stale link to `/listener-apply` — all call
 * `openMentorSide` / `enterMentorPath` or render `MentorPathFlow`, which reads `stateOf`.
 * Nothing else decides where a mentor door leads.
 *
 * The way back (Mentor Home's "I'd rather talk today", the loop's own link) is
 * `continueAsMember`: it walks only the member sign-up steps the ACCOUNT is missing
 * (server `GET /me`), then lands on My Chats — never a second account.
 *
 * Navigation rule (CLAUDE.md gotchas): `dismissTo`, never `replace`, onto Mentor Home or a
 * tab route from inside the app; `replace` is used only where the current screen is a
 * pre-session root (the onboarding journey) or a screen that must not stay in history.
 */
import type { Router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { api, type ListenerApplication } from '@/lib/api';
import { setDraft } from '@/lib/onboardingDraft';
import { screenCache } from '@/lib/screenCache';
import { getCompanionAnimal, saveCompanionAnimal, saveRole } from '@/lib/session';

export type MentorPathState = 'none' | 'review' | 'declined' | 'approved';

/** The loop's screens, in order. `age` exists only for a visitor with no session. */
export type MentorPathStep = 'story' | 'age' | 'primer' | 'form' | 'status';

export function stateOf(application: ListenerApplication | null): MentorPathState {
  if (!application) return 'none';
  if (application.status === 'approved') return 'approved';
  if (application.status === 'declined') return 'declined';
  return 'review';
}

/** Where a door lands inside the loop for a given state (approved never reaches the loop
 * through a door — `openMentorSide` sends it to Mentor Home). */
export function firstStep(state: MentorPathState): MentorPathStep {
  return state === 'none' ? 'story' : 'status';
}

/** The step after `step` going forward. The age gate only for someone with no session. */
export function nextStep(step: MentorPathStep, hasSession: boolean): MentorPathStep {
  switch (step) {
    case 'story':
      return hasSession ? 'primer' : 'age';
    case 'age':
      return 'primer';
    case 'primer':
      return 'form';
    default:
      return 'status';
  }
}

/** The step behind `step` going back, or null when back leaves the loop. */
export function previousStep(step: MentorPathStep): MentorPathStep | null {
  switch (step) {
    case 'age':
      return 'story';
    case 'primer':
      // A visitor already past the age gate never meets it twice: back is the story.
      return 'story';
    case 'form':
      return 'primer';
    default:
      return null;
  }
}

/** When a declined applicant may apply again — the server owns the 30-day cooldown. */
export function reapplyAt(application: ListenerApplication | null): Date | null {
  const raw = application?.status === 'declined' ? application.reapply_after : null;
  if (!raw) return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** A declined applicant whose month has passed (or whose server did not say — an older
 * server; the submit's own 409 is then the judge). */
export function canReapply(application: ListenerApplication | null, now = new Date()): boolean {
  if (application?.status !== 'declined') return false;
  const at = reapplyAt(application);
  return !at || at.getTime() <= now.getTime();
}

/** One read of the server's truth, remembered for the next screen (no spinner on return). */
export async function loadApplication(): Promise<ListenerApplication | null> {
  const application = await api.getListenerApplication();
  screenCache.set('application', application);
  return application;
}

/** The state for a screen: starts from the last-loaded value, refreshes on every focus.
 * `application === undefined` = never loaded yet; `failed` = the last refresh failed (the
 * stale value, if any, stays on screen and the screen goes still). */
export function useMentorPath(enabled = true) {
  const [application, setApplication] = useState<ListenerApplication | null | undefined>(() =>
    screenCache.get('application'),
  );
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const a = await loadApplication();
      setApplication(a);
      setFailed(false);
      return a;
    } catch {
      setFailed(true);
      return undefined;
    }
  }, []);
  // `enabled` = there is a session to ask with. A visitor on the public page has none, and an
  // unauthenticated read would bounce them to the landing (lib/api.ts 401 handling).
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refresh();
    }, [refresh, enabled]),
  );
  return {
    application,
    setApplication: (a: ListenerApplication | null) => {
      screenCache.set('application', a);
      setApplication(a);
    },
    state: application === undefined ? undefined : stateOf(application),
    failed,
    refresh,
  };
}

/** THE door from the member side (Profile's mentor row). Approved → the device becomes a
 * mentor's and Mentor Home opens on top (back returns here); anything else → the loop. */
export async function openMentorSide(
  router: Pick<Router, 'push'>,
  application: ListenerApplication | null | undefined,
): Promise<void> {
  if (application !== undefined && stateOf(application) === 'approved') {
    await saveRole('mentor');
    router.push('/mentor-home');
    return;
  }
  router.push('/listener-apply');
}

/** The door at the end of the role fork's mentor branch (and any pre-session root): the
 * screen it replaces must not stay in history. Reads the server so a returning applicant
 * with a reused session lands where their application stands. */
export async function enterMentorPath(router: Pick<Router, 'dismissAll' | 'replace'>): Promise<void> {
  let application: ListenerApplication | null | undefined;
  try {
    application = await loadApplication();
  } catch {
    application = undefined; // the loop shows its own still error + retry
  }
  router.dismissAll();
  if (application !== undefined && stateOf(application) === 'approved') {
    router.replace('/mentor-home');
    return;
  }
  router.replace('/listener-apply');
}

/** From the mentor side back to the member side ("I'd rather talk today", the loop's way
 * back). The member sign-up continues with ONLY the steps the account is missing — asked of
 * the SERVER (`GET /me`), with the device as a fallback when it cannot be reached:
 *  - no companion → the member journey resumes at the companion pick, on the SAME session
 *    (age and email were given at mentor sign-up; email is optional and never blocks),
 *    then Ready → My Chats;
 *  - nothing missing → straight to My Chats.
 * Every account has passed the server-side age gate by construction (a session only comes
 * from `POST /onboarding/start`, which requires the 18+ date of birth — the public `/apply`
 * page included), so the age step is never re-asked; `has_dob` on `GET /me` states it. */
export async function continueAsMember(
  router: Pick<Router, 'dismissAll' | 'replace' | 'dismissTo'>,
): Promise<void> {
  let animal: string | null = null;
  let complete: boolean | null = null;
  try {
    const me = await api.me();
    animal = me.companion_animal;
    complete = me.member_setup_complete ?? Boolean(me.companion_animal);
  } catch {
    animal = await getCompanionAnimal();
    complete = Boolean(animal);
  }
  if (complete && animal) {
    // The account has it; make sure this device does too (a reinstall, another device).
    if ((await getCompanionAnimal()) !== animal) await saveCompanionAnimal(animal);
    await saveRole('mentee');
    router.dismissTo('/chats');
    return;
  }
  // The role flips to mentee only once the pick is made (OnboardingJourney) — backing out
  // leaves them on the mentor side.
  setDraft({ role: 'mentee', sessionBacked: true });
  router.dismissAll();
  router.replace({ pathname: '/onboarding', params: { step: 'companion' } });
}
