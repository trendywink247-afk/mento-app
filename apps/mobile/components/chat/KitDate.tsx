/**
 * KitDate — the kit's sticky date pill and inline date separator, drawn with our own label
 * (lib/chatDay.ts) instead of its calendar-formatted one, which printed a raw ISO timestamp
 * over the messages here. Styling still comes from the kit theme (`dateHeader`,
 * `inlineDateSeparator` in ChatScreen's streamTheme).
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTheme as useKitTheme } from 'stream-chat-expo';

import { chatDayLabel } from '@/lib/chatDay';
import { useI18n } from '@/lib/i18n';

function useDayLabel(date?: Date): string | null {
  const { t, locale } = useI18n();
  if (!date || Number.isNaN(date.getTime())) return null;
  return chatDayLabel(date, new Date(), { today: t('chat.dayToday'), yesterday: t('chat.dayYesterday') }, locale);
}

export function KitStickyHeader({ date }: { date?: Date }) {
  const label = useDayLabel(date);
  const { theme } = useKitTheme();
  if (!label) return null;
  return (
    <View style={[styles.pill, theme.dateHeader.container]} testID="sticky-date">
      <Text style={theme.dateHeader.text}>{label}</Text>
    </View>
  );
}

export function KitInlineDateSeparator({ date }: { date?: Date }) {
  const label = useDayLabel(date);
  const { theme } = useKitTheme();
  if (!label) return null;
  return (
    <View style={[styles.inline, theme.inlineDateSeparator.container]} testID="date-separator">
      <Text style={theme.inlineDateSeparator.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { alignSelf: 'center', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  inline: { alignSelf: 'center', paddingVertical: 8 },
});
