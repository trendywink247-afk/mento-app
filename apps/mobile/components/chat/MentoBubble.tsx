/**
 * MentoBubble — the native thread's bubble, drawn by US inside the Stream kit.
 *
 * It replaces the kit's `MessageContent` (its whole bubble: surface, corners, padding and
 * the words), and nothing else: `MessageItemView` still renders our Saved chip above it
 * (`MessageHeader` → KitSavedHeader) and our delivery line / save key below it
 * (`MessageFooter` → KitMessageFooter), and `Channel` / `MessageList` still do the work the
 * hand-rolled web thread has never done — keyboard avoidance, backward pagination, marking
 * the channel read, reconnect and re-sync, the inverted list.
 *
 * ## Why the kit stopped drawing it
 *
 * Every native chat bug of 20 Sep came from re-skinning someone else's bubble through its
 * theme and hoping it landed on board A05: an avatar gutter beside every mentor message, a
 * hard 256px cap on the text, the member's own bubbles in the kit's default blue under our
 * white words, and — trying to fix the padding through the theme — words clipping out of an
 * unpadded pillow. None of it was catchable here: no e2e spec drives a native chat.
 * Drawing the bubble with the same component the web thread uses (components/chat/Bubble.tsx)
 * ends that: one bubble, one set of numbers, and the browser specs that cover ThreadRow now
 * cover the phone's bubble too.
 *
 * Press behaviour stays the kit's, so the long-press menu (Save to Mentor Notes on an older
 * message, Copy, Quoted reply — ChatScreen's `customMessageActions`) keeps working.
 */
import { Pressable } from 'react-native';
import { useMessageContext } from 'stream-chat-expo';

import { Bubble } from '@/components/chat/Bubble';

export function MentoBubble() {
  const { message, isMyMessage, onLongPress, onPress, preventPress } = useMessageContext();
  const text = message?.text ?? '';

  return (
    <Pressable
      disabled={preventPress}
      onLongPress={(event) => {
        if (onLongPress) onLongPress({ emitter: 'messageContent', event });
      }}
      onPress={(event) => {
        if (onPress) onPress({ emitter: 'messageContent', event });
      }}
      testID={isMyMessage ? `mine-${message?.id}` : `msg-${message?.id}`}
    >
      <Bubble mine={isMyMessage} text={text} />
    </Pressable>
  );
}
