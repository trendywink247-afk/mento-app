/** Ephemeral, in-memory onboarding draft (pre-account). Never persisted to disk. */
export type OnboardingDraft = {
  dob?: string; // YYYY-MM-DD
  email?: string | null;
  companionAnimal?: string | null;
  companionColour?: string | null;
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
