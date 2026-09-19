/**
 * KitSavedHeader — the native kit's `MessageHeader` slot (above a bubble), used for one
 * thing: the small "Saved" chip on a mentor message that is in Mentor Notes (board A05).
 * It settles in when the note was kept during this visit and is simply there otherwise.
 *
 * Platform note: on the board (and on web) the chip overlaps the bubble's top-right
 * corner; the kit's bubble clips its own overflow, so on native it rests just above that
 * corner instead.
 */
import { useContext } from 'react';
import { StyleSheet, View } from 'react-native';
import { useMessageContext } from 'stream-chat-expo';

import { KitThreadContext } from '@/components/chat/KitMessageFooter';
import { SavedChip } from '@/components/chat/SavedChip';

export function KitSavedHeader() {
  const thread = useContext(KitThreadContext);
  const { isMyMessage, message } = useMessageContext();
  if (isMyMessage || !thread.savedIds.has(message.id)) return null;
  return (
    <View style={styles.seat}>
      <SavedChip settle={thread.savedNow.has(message.id)} testID={`saved-${message.id}`} />
    </View>
  );
}

const styles = StyleSheet.create({
  seat: { alignSelf: 'flex-end', marginRight: 14, marginBottom: -2 },
});
