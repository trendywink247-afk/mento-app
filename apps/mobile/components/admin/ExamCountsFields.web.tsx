/**
 * ExamCountsFields: prelims / mains / interview counts and the "proof checked" switch
 * (DECISIONS R.4, R.7). Shared by the roster's tier control, approving an application as a
 * Mentor, creating a Mentor directly and approving an exam document.
 */
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { ExamCountsText } from '@/lib/adminTiers';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const STAGES = ['prelims', 'mains', 'interview'] as const;
const LABEL = { prelims: 'Prelims', mains: 'Mains', interview: 'Interview' } as const;

export const EMPTY_COUNTS: ExamCountsText = { prelims: '', mains: '', interview: '' };

export function ExamCountsFields({
  value,
  onChange,
  checked,
  onChecked,
  testID,
}: {
  value: ExamCountsText;
  onChange: (next: ExamCountsText) => void;
  /** Omit to hide the switch (a document approval is itself the check). */
  checked?: boolean;
  onChecked?: (next: boolean) => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {STAGES.map((s) => (
          <View key={s} style={styles.field}>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{LABEL[s]} cleared</Text>
            <TextInput
              value={value[s]}
              onChangeText={(v) => onChange({ ...value, [s]: v.replace(/[^0-9]/g, '') })}
              keyboardType="number-pad"
              maxLength={2}
              placeholder="0"
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel={`${LABEL[s]} cleared, times`}
              style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
              testID={`${testID}-${s}`}
            />
          </View>
        ))}
      </View>
      {onChecked ? (
        <View style={styles.checkRow}>
          <Switch
            value={Boolean(checked)}
            onValueChange={onChecked}
            accessibilityLabel="Proof checked: show exam badges to members"
            testID={`${testID}-checked`}
          />
          <Text style={[type.caption, { color: colors.ink }]}>Proof checked (badges show to members)</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'flex-end' },
  field: { gap: 2 },
  input: { width: 72, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
});
