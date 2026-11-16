import type { Role } from '@/lib/session';

/** Ephemeral, in-memory onboarding draft (pre-account). Never persisted to disk. */
export type OnboardingDraft = {
  role?: Role;
  dob?: string; // YYYY-MM-DD
  email?: string | null;
  companionAnimal?: string | null;
  companionColour?: string | null;
  /** The member's own name for the companion (cleaned; null = none). Never analytics. */
  companionName?: string | null;
  /** Continuing past the age step, under the house-rules line, is agreeing (WS3 T3.9). */
  termsAccepted?: boolean;
  /** The person already holds a session (a mentor choosing to talk): the age gate
   * was passed server-side at hand-off, so there is no DOB in memory — and the
   * journey must NOT mint a second account. Resumes at the companion pick. */
  sessionBacked?: boolean;
  /** Opened from Profile > Theme to change the companion: the pick is saved and the
   * person goes straight back to Theme, with no Ready screen and no role change. */
  fromTheme?: boolean;
};

const draft: OnboardingDraft = {};

export function setDraft(patch: Partial<OnboardingDraft>): void {
  Object.assign(draft, patch);
}

export function getDraft(): OnboardingDraft {
  return draft;
}

export function clearDraft(): void {
  for (const key of Object.keys(draft) as (keyof OnboardingDraft)[]) delete draft[key];
}
