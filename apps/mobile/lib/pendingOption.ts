/**
 * One-shot cross-screen signal: lets the mentor profile screen ask the chat screen
 * to open a specific ConversationOptions sub-flow on return, without a route-param
 * round trip (a `router.setParams` on the screen being popped back to is unreliable
 * across a stack `back()` on this expo-router version). `set()` right before
 * `router.back()`; the chat screen calls `take()` once on focus — it clears on
 * read so a later, unrelated focus never re-fires it.
 *
 * Module-level (not persisted): the report hand-off only ever spans one in-memory
 * navigation, so this is simpler and safer than SecureStore/AsyncStorage for it.
 */
export type PendingOption = 'report';

let pending: PendingOption | null = null;

export const pendingOption = {
  set(option: PendingOption): void {
    pending = option;
  },
  take(): PendingOption | null {
    const value = pending;
    pending = null;
    return value;
  },
};
