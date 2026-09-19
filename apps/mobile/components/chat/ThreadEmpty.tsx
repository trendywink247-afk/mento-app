/**
 * The thread before the first message (board A05's language, drawn with nothing in it):
 * the column rests on the composer like every thread does, under the day label the first
 * bubble will sit beneath, with two quiet lines and the one safety line a member should
 * read BEFORE they talk (founder review 2026-09-20: it had gone missing when the old
 * rotating safety cards went). No illustration — the member's companion already leans over
 * the field, and the old indigo "connected" scene was off the board's palette. Still:
 * nothing here moves, and the line never warns — it simply says how this place works.
 *
 * Used by the web thread (ListEmptyComponent) and, on native, as the kit's message-list
 * `EmptyStateIndicator` (member chat only).
 */
import { Ionicons } from '@expo/vector-icons';
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
      <View style={styles.privacy} testID="chat-empty-privacy">
        <Ionicons name="lock-closed-outline" size={14} color={colors.inkMuted} />
        <Text style={[type.caption, styles.privacyText, { color: colors.inkMuted }]}>
          {t('askFlow.threadPrivacy')}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', gap: 2, paddingHorizontal: space.lg, paddingBottom: space.sm },
  day: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  privacy: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 10, paddingHorizontal: space.sm },
  privacyText: { flexShrink: 1, textAlign: 'center' },
  centered: { textAlign: 'center' },
});
