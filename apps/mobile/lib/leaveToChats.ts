/**
 * Leaving a chat (back key, End → reflection, Clean Wipe, Report) returns to My Chats.
 *
 * `dismissTo`, never `replace`: a chat opened from the tabs sits ON TOP of them, and
 * `router.replace('/chats')` swapped it for a brand-new tab navigator stacked on the old one —
 * every tab remounted (spinner, loaded data dropped, scroll lost) and the stack grew by one
 * hidden copy of the tabs per chat visited. `dismissTo` pops back to the tabs that are already
 * there and focuses Chats; when none are beneath (chat reached straight from onboarding) it
 * falls back to replacing the current screen, which is the old behaviour.
 */
import type { Router } from 'expo-router';

export function leaveToChats(router: Pick<Router, 'dismissTo'>): void {
  router.dismissTo('/chats');
}
