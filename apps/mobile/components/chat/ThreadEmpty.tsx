/**
 * The thread before the first message (board A05's language, drawn with nothing in it):
 * the column rests on the composer like every thread does, under the day label the first
 * bubble will sit beneath, with two quiet lines. No illustration — the member's companion
 * already leans over the field, and the old indigo "connected" scene was off the board's
 * palette. Still: nothing here moves.
 *
 * Used by the web thread (ListEmptyComponent) and, on native, as the kit's message-list
 * `EmptyStateIndicator` (member chat only).
 */
import { StyleSheet, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, space, type } from '@/theme/tokens';

export function ThreadEmpty({ listType }: { listType?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  if (listType && listType !== 'message') return null;
  return (
    <View style={styles.wrap} testID="chat-empty">
      <Text style={[styles.day, { color: colors.inkMuted }]}>{t('askFlow.threadDay')}</Text>
      <Text style={[type.keyDense, styles.centered, { color: colors.ink }]} accessibilityRole="header">
        {t('chat.emptyTitle')}
      </Text>
      <Text style={[type.note, styles.centered, { color: colors.inkMuted }]}>{t('askFlow.threadHint')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', gap: 2, paddingHorizontal: space.lg, paddingBottom: space.sm },
  day: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  centered: { textAlign: 'center' },
});
