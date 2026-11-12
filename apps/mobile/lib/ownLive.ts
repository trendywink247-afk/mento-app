import type { ListenerConversation } from '@/lib/listenerApi';
import type { ChannelLive } from '@/lib/useMentorConsole';

/** The live row state for an OWN chat, from the server's own fields (a Stream chat is mirrored
 * from Stream instead): unread count, and since when the member has been waiting. */
export function ownLive(conversation: ListenerConversation): ChannelLive | undefined {
  if (conversation.chat_backend !== 'own' || conversation.status !== 'active') return undefined;
  const since = conversation.waiting_since ? new Date(conversation.waiting_since).getTime() : NaN;
  return {
    unread: conversation.unread ?? 0,
    preview: conversation.last_message_preview ?? null,
    typing: false,
    waitingSince: Number.isFinite(since) ? since : null,
  };
}

/** The active rooms that live on Stream: the only ones the console mirrors from Stream. A row
 * without `chat_backend` comes from an older server, where every chat was a Stream chat. */
export function streamRooms(
  conversations: readonly ListenerConversation[],
): Array<ListenerConversation & { stream_channel_id: string }> {
  return conversations.filter(
    (c): c is ListenerConversation & { stream_channel_id: string } =>
      c.status === 'active' && c.chat_backend !== 'own' && c.stream_channel_id !== null,
  );
}

/** Whether a console row opens a chat: an own chat needs only to exist (its socket is keyed by
 * the conversation), a Stream chat needs its channel. A wiped chat never opens. */
export function canOpenConsoleChat(conversation: ListenerConversation): boolean {
  if (conversation.status === 'wiped') return false;
  return conversation.chat_backend === 'own' || !!conversation.stream_channel_id;
}
