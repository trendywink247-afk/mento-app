/**
 * KitTyping — the native kit's `TypingIndicator`, replaced with the board's (A05): the small
 * dotted pill and "Steady Cedar is typing…". Reads the kit's own typing state, so nothing
 * about who-is-typing changes — only how it is drawn.
 */
import { useChatContext, useTypingContext } from 'stream-chat-expo';

import { TypingDots } from '@/components/chat/TypingDots';
import { useI18n } from '@/lib/i18n';

export function KitTyping() {
  const { t } = useI18n();
  const { client } = useChatContext();
  const { typing } = useTypingContext();
  const other = Object.values(typing ?? {}).find((e) => e.user && e.user.id !== client.userID);
  if (!other?.user) return null;
  return <TypingDots testID="typing-indicator" label={t('chat.typing', { name: other.user.name ?? t('chat.yourListener') })} />;
}
