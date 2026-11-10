import type { ListenerConversation } from '@/lib/listenerApi';
import type { ChannelLive } from '@/lib/useMentorConsole';

/** The live row state for an OWN chat, from the server's own fields (a Stream chat is mirrored
 * from Stream instead): unread count, and since when the member has been waiting. */
export function ownLive(conversation: ListenerConversation): ChannelLive | undefined {
  if (conversation.chat_backend !== 'own' || conversation.status !== 'active') return undefined;
  const since = conversation.waiting_since ? new Date(conversation.waiting_since).getTime() : NaN;
  return {
    unread: conversation.unread ?? 0,
    preview: null,
    typing: false,
    waitingSince: Number.isFinite(since) ? since : null,
  };
}
