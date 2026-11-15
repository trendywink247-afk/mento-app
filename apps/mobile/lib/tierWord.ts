/**
 * The word a member sees for a volunteer's tier (DECISIONS R.4, R.9): Listener, Mentor or
 * Mento Verified. An older server that sends no tier keeps the old word, "Mentor".
 */
import type { Tier } from '@/lib/api';
import type { TKey } from '@/lib/i18n';

export function tierKey(tier: Tier | null | undefined): TKey {
  if (tier === 'listener') return 'tier.listener';
  if (tier === 'verified') return 'tier.verified';
  return 'tier.mentor';
}
