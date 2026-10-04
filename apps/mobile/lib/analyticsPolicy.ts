/** Runtime privacy boundary: event inputs never become network payloads directly. */
export type WaitBucket = '<5s' | '5-15s' | '15-60s' | '>60s';
export type EventMap = {
  landing_viewed: undefined;
  onboarding_started: undefined;
  role_chosen: { role: 'mentee' | 'mentor' };
  onboarding_age_passed: undefined;
  onboarding_email_step: { skipped: boolean };
  onboarding_companion_chosen: { companion: string };
  onboarding_completed: undefined;
  path_chosen: { community: string };
  match_requested: { mode: 'general' | 'personal' };
  match_found: { wait_bucket: WaitBucket };
  chat_first_message_sent: undefined;
  reflection_submitted: undefined;
  mentor_profile_viewed: undefined;
  mentor_favourited: { on: boolean };
};

type SafeProperties = Record<string, string | boolean>;
const RULES: Record<keyof EventMap, Record<string, readonly (string | boolean)[]>> = {
  landing_viewed: {},
  onboarding_started: {},
  role_chosen: { role: ['mentee', 'mentor'] },
  onboarding_age_passed: {},
  onboarding_email_step: { skipped: [true, false] },
  onboarding_companion_chosen: {
    companion: ['Panda', 'Elephant', 'Fox', 'Turtle', 'Deer', 'Owl', 'Dog', 'Cat', 'Capybara'],
  },
  onboarding_completed: {},
  path_chosen: { community: ['upsc', 'neet', 'jee', 'exams', 'life'] },
  match_requested: { mode: ['general', 'personal'] },
  match_found: { wait_bucket: ['<5s', '5-15s', '15-60s', '>60s'] },
  chat_first_message_sent: {},
  reflection_submitted: {},
  mentor_profile_viewed: {},
  mentor_favourited: { on: [true, false] },
};

/** Reject malformed/unknown events silently; copy only approved scalar properties.
 * Accessors and inherited properties never supply a value. Unknown properties
 * (including toJSON hooks) are not read and cannot reach JSON serialization. */
export function safeEvent(event: unknown, props: unknown): SafeProperties | null {
  if (typeof event !== 'string' || !Object.hasOwn(RULES, event)) return null;
  if (props !== undefined && (props === null || typeof props !== 'object' || Array.isArray(props))) {
    return null;
  }
  const clean: SafeProperties = {};
  try {
    for (const [name, choices] of Object.entries(RULES[event as keyof EventMap])) {
      const descriptor = props === undefined ? undefined : Object.getOwnPropertyDescriptor(props, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !choices.includes(descriptor.value)) {
        return null;
      }
      clean[name] = descriptor.value;
    }
  } catch {
    return null;
  }
  return clean;
}

/** A flagged server response never becomes a first-message engagement event.
 * This cannot remove earlier funnel events or prove later crisis-session cohort
 * exclusion; analytics must stay dark until that separate contract is accepted. */
export function mayCaptureFirstMessage(message: unknown): boolean {
  if (message === null || typeof message !== 'object' || Array.isArray(message)) return false;
  try {
    return !('crisis' in message);
  } catch {
    return false;
  }
}

type Dependencies = {
  enabled: boolean;
  loadOrCreateId: () => Promise<string>;
  forgetId: () => Promise<void>;
  send: (event: keyof EventMap, properties: SafeProperties, id: string) => unknown;
};

/** Fence pending captures on identity reset and serialize storage writes/removal.
 * A failed removal keeps telemetry dark until a successful reset; it must never
 * reuse an old identity after account erasure. Network failures remain silent. */
export function createPrivateAnalytics(deps: Dependencies) {
  let generation = 0;
  let blocked = false;
  let identity: Promise<string> | null = null;
  let storageTail: Promise<unknown> = Promise.resolve();
  return {
    capture(event: unknown, props?: unknown): void {
      if (!deps.enabled || blocked) return;
      const clean = safeEvent(event, props);
      if (clean === null) return;
      const capturedGeneration = generation;
      if (identity === null) {
        identity = storageTail.then(deps.loadOrCreateId);
        storageTail = identity.catch(() => {});
      }
      const capturedIdentity = identity;
      capturedIdentity.then((id) => {
        if (capturedGeneration === generation && !blocked) {
          return deps.send(event as keyof EventMap, clean, id);
        }
      }).catch(() => {
        if (capturedGeneration === generation && identity === capturedIdentity) identity = null;
      });
    },
    forget(): Promise<void> {
      generation += 1;
      const resettingGeneration = generation;
      blocked = true;
      identity = null;
      const removal = storageTail.then(deps.forgetId);
      storageTail = removal.catch(() => {});
      return removal.then(() => {
        if (generation === resettingGeneration) blocked = false;
      }).catch(() => {});
    },
  };
}
