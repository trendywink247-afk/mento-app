import type { Channel, StreamChat } from 'stream-chat';

/** Stream refreshes channel.state before connection.recovered; it does not emit
 * message.new for each missed message. Custom web threads must project that state.
 */
export function subscribeToRecoveredMessages(
  client: StreamChat,
  channel: Channel,
  recovered: (messages: Channel['state']['messages']) => void,
): () => void {
  let active = true;
  const subscription = client.on('connection.recovered', () => {
    if (active) recovered([...channel.state.messages]);
  });
  return () => {
    active = false;
    subscription.unsubscribe();
  };
}

/** Preserve older loaded history outside the SDK's recovery page, update matching
 * IDs, and insert missed messages in time order rather than after newer live ones.
 */
export function mergeRecoveredMessages<T extends { id: string; at: string }>(
  current: readonly T[],
  recovered: readonly T[],
): T[] {
  const messages = new Map(current.map(message => [message.id, message]));
  for (const message of recovered) messages.set(message.id, message);
  return [...messages.values()].sort((a, b) => a.at.localeCompare(b.at));
}
