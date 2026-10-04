/** Native's current renderer is the Stream kit. Verify the persisted owner before
 * opening that provider; route channel aliases and web acceptance flags are not
 * authorization to create a second transport for an own room.
 * Own native rendering must land with its own acceptance gate before this guard
 * gains an own branch. No implicit fallback is safe for an unknown owner.
 */
export class NativeChatOwnerError extends Error {}

export async function requireNativeStreamOwner(
  load: () => Promise<{ chat_backend?: string }>,
): Promise<void> {
  const state = await load();
  if (state.chat_backend !== 'stream') {
    throw new NativeChatOwnerError(state.chat_backend === 'own' ? 'own_native_not_accepted' : 'unknown_chat_owner');
  }
}
