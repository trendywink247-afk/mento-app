import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Mentor Home's week strip (founder choice, 2026-11-08): conversations this week, usual reply time
 * and free seats. The reply time is the server's 30-day median, shown only once there is enough to say.
 */
export function HomeStats({
  weekCount,
  reply,
  seatsFree,
}: {
  weekCount: number;
  reply: 'day' | 'two_days' | null | undefined;
  seatsFree: number;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const replyText = reply === 'day' ? t('mentor.replyDay') : reply === 'two_days' ? t('mentor.replyTwoDays') : t('mentor.replyNone');
  const cell = (value: string, label: string, small = false, testID?: string) => (
    <EdgeSurface
      edge={colors.edgeSurface}
      radius={radius.lg}
      containerStyle={styles.cellBox}
      style={[styles.cell, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={testID}
    >
      <Text style={[small ? styles.valueSmall : styles.value, { color: colors.ink }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
        {label}
      </Text>
    </EdgeSurface>
  );
  return (
    <View style={styles.row} testID="mentor-home-stats">
      {cell(String(weekCount), t('mentor.statWeek'), false, 'stat-week')}
      {cell(replyText, t('mentor.statReply'), true, 'stat-reply')}
      {cell(String(seatsFree), t('mentor.statSeats'), false, 'stat-seats')}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  cellBox: { flex: 1 },
  cell: { borderWidth: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 0 },
  value: { fontSize: 28, lineHeight: 36, fontFamily: type.displaySerif.fontFamily },
  valueSmall: { fontSize: 20, lineHeight: 36, fontFamily: type.displaySerif.fontFamily },
});
