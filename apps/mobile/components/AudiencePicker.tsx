import { StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import type { Audience } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const CHOICES: { key: Audience; label: TKey; hint: TKey }[] = [
  { key: 'any', label: 'audience.any', hint: 'audience.anyHint' },
  { key: 'in_service', label: 'audience.verified', hint: 'audience.verifiedHint' },
  { key: 'peer', label: 'audience.peers', hint: 'audience.peersHint' },
];

/** Who may take a question: any mentor (the default), Mento Verified, or peers. Chosen by the member, per question. */
export function AudiencePicker({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const hint = CHOICES.find((c) => c.key === value)?.hint ?? 'audience.anyHint';
  return (
    <View style={styles.wrap} testID="audience-picker">
      <Text style={[type.label, { color: colors.ink }]}>{t('audience.title')}</Text>
      <View style={styles.row} accessibilityRole="radiogroup">
        {CHOICES.map((c) => {
          const on = value === c.key;
          return (
            <PressKey
              key={c.key}
              onPress={() => onChange(c.key)}
              edge={on ? colors.accentTintEdge : colors.edgeSurface}
              travel={3}
              radius={radius.pill}
              intent="select"
              accessibilityRole="radio"
              accessibilityState={{ checked: on }}
              testID={`audience-${c.key}`}
              containerStyle={styles.cell}
              style={[styles.chip, { backgroundColor: on ? colors.accentTint : colors.surface, borderColor: on ? colors.accent : colors.border }]}
            >
              <Text style={[type.label, { color: on ? colors.accentInk : colors.ink }]} numberOfLines={1}>
                {t(c.label)}
              </Text>
            </PressKey>
          );
        })}
      </View>
      <Text style={[type.caption, { color: colors.inkMuted }]}>{t(hint)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  row: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
  chip: { minHeight: 44, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
