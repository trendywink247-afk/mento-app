/**
 * KitMessageFooter — the native kit's `MessageFooter`, replaced (board A05): no per-message
 * clock, no ticks.
 *   - Under the member's LATEST message: one quiet line, "Read" or "Delivered"
 *     ("Delivered · 3 in a row" while the allowance's pause is showing).
 *   - Under the mentor's LATEST message, until it is kept: the "Save to Mentor Notes" key
 *     and its one-line nudge. (Any older mentor message is kept from its long-press menu,
 *     as before.)
 *   - Everything else: nothing.
 *
 * The kit says which of the member's messages is the last (`showMessageStatus`) and whether
 * the other side has read it (`readBy`); the screen says which mentor message is the latest
 * and what has been kept, through KitThreadContext — the kit mounts this component itself,
 * so no prop of ours reaches it.
 */
import { createContext, useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useMessageContext } from 'stream-chat-expo';

import { SaveKey } from '@/components/chat/SaveKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font } from '@/theme/tokens';

export type KitThread = {
  /** The mentor's latest message — the one that carries the save key. */
  lastTheirsId: string | null;
  /** Every message of this thread that is in Mentor Notes. */
  savedIds: ReadonlySet<string>;
  /** …and the ones kept during this visit (their chip settles in). */
  savedNow: ReadonlySet<string>;
  /** The member's current run while the three-in-a-row note shows, else null. */
  run: number | null;
  onSave: (message: { id: string; text?: string }) => void;
};

export const KitThreadContext = createContext<KitThread>({
  lastTheirsId: null,
  savedIds: new Set(),
  savedNow: new Set(),
  run: null,
  onSave: () => {},
});

export function KitMessageFooter() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const thread = useContext(KitThreadContext);
  const { isMyMessage, showMessageStatus, readBy, message } = useMessageContext();

  if (!isMyMessage) {
    if (message.id !== thread.lastTheirsId || thread.savedIds.has(message.id) || !message.text) return null;
    return (
      <View style={styles.save}>
        <SaveKey onPress={() => thread.onSave(message)} nudge testID={`save-card-${message.id}`} />
      </View>
    );
  }

  if (!showMessageStatus) return null;
  if (message.status === 'sending' || message.status === 'failed' || message.type === 'error') return null;
  const text = readBy
    ? t('allowance.read')
    : thread.run !== null
      ? t('allowance.deliveredRow', { count: thread.run })
      : t('allowance.delivered');
  return (
    <Text style={[styles.line, { color: colors.inkMuted }]} testID="chat-delivery" maxFontSizeMultiplier={1.3}>
      {text}
    </Text>
  );
}

const styles = StyleSheet.create({
  save: { paddingTop: 8 },
  line: {
    alignSelf: 'flex-end',
    fontFamily: font.sans,
    fontSize: 12,
    lineHeight: 16,
    paddingRight: 6,
    paddingTop: 4,
  },
});
