/**
 * One-shot cross-screen signal: lets the mentor profile screen ask the chat screen
 * to open a specific ConversationOptions sub-flow on return, without a route-param
 * round trip (a `router.setParams` on the screen being popped back to is unreliable
 * across a stack `back()` on this expo-router version). `set(conversationId, option)`
 * right before `router.back()`; the chat screen calls `take(conversationId)` once on
 * focus — it clears the store regardless of outcome, and only returns the option when
 * the conversation id matches, so a mismatch (e.g. the member switched chats before
 * this fired) can never leak the flow into an unrelated conversation later.
 *
 * Module-level (not persisted): the report hand-off only ever spans one in-memory
 * navigation, so this is simpler and safer than SecureStore/AsyncStorage for it.
 */
export type PendingOption = 'report';

let pendingConversationId: string | null = null;
let pendingValue: PendingOption | null = null;

export const pendingOption = {
  set(conversationId: string, option: PendingOption): void {
    pendingConversationId = conversationId;
    pendingValue = option;
  },
  take(conversationId: string): PendingOption | null {
    const id = pendingConversationId;
    const value = pendingValue;
    pendingConversationId = null;
    pendingValue = null;
    return id === conversationId ? value : null;
  },
};
