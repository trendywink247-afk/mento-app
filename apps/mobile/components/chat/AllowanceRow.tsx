/**
 * AllowanceRow — the quiet line above the message field (board A05): the battery of pips
 * and "7 of 10 messages left today · up to 3 in a row". Inside the crisis-exempt window it
 * says the last message was not counted instead (board A21), and nothing on it moves.
 */
import { StyleSheet, Text, View } from 'react-native';

import { AllowanceMeter } from '@/components/chat/AllowanceMeter';
import type { Allowance } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { type } from '@/theme/tokens';

export function AllowanceRow({ allowance, exempt }: { allowance: Allowance; exempt: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const counts = { left: allowance.left_today, limit: allowance.daily_limit, row: allowance.in_a_row_limit };
  return (
    <View style={styles.row} testID="allowance-row">
      <AllowanceMeter
        left={allowance.left_today}
        limit={allowance.daily_limit}
        alive={!exempt}
        accessibilityLabel={t('allowance.meterA11y', counts)}
      />
      <Text style={[type.caption, styles.text, { color: colors.inkMuted }]} testID="allowance-text">
        {exempt ? t('allowance.notCounted', counts) : t('allowance.left', counts)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  text: { flex: 1, lineHeight: 16 },
});
