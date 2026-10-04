/** Native selects its renderer from the authenticated persisted owner. Route
 * aliases and web acceptance alone cannot authorize a second transport. Own
 * rendering additionally requires explicit native acceptance; unknown owners
 * never fall back. Stream-specific setup retains its stricter owner guard.
 */
export class NativeChatOwnerError extends Error {}

export function nativeChatRenderer(owner: string | undefined, acceptance: {
  own?: string; native?: string;
}): 'stream' | 'own' {
  if (owner === 'stream') return 'stream';
  if (owner === 'own' && acceptance.own === '1' && acceptance.native === '1') return 'own';
  throw new NativeChatOwnerError(owner === 'own' ? 'own_native_not_accepted' : 'unknown_chat_owner');
}

export async function requireNativeStreamOwner(
  load: () => Promise<{ chat_backend?: string }>,
): Promise<void> {
  const state = await load();
  if (state.chat_backend !== 'stream') {
    throw new NativeChatOwnerError(state.chat_backend === 'own' ? 'own_native_not_accepted' : 'unknown_chat_owner');
  }
}
