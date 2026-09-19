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

/** The mentor side of the same rule: a mentor chat (and the member brief above it) sits ON TOP
 * of Mentor Home — or, in a bare token-link browser, of the `/listener` console list.
 * `replace` swapped the chat for a SECOND copy of the home screen and left the first one
 * mounted underneath (two consoles polling, two heartbeats); `dismissTo` pops back to the one
 * that is already there, and replaces only when none is beneath (a chat opened from a push). */
export function leaveToMentorHome(
  router: Pick<Router, 'dismissTo'>,
  home: '/mentor-home' | '/listener' = '/mentor-home',
): void {
  router.dismissTo(home);
}

/** A screen reached from the Path tab with nothing to show (a stray deep link) goes back to
 * the tabs that are already mounted rather than stacking a new tab navigator. */
export function leaveToPath(router: Pick<Router, 'dismissTo'>): void {
  router.dismissTo('/path');
}
