import { StyleSheet, Switch, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { flatRowStyle, useFlatSurfaces, useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** "Show my companion" (DECISIONS R.3): off after skipping it at signup; kept on this
 * phone only. Turning it on with no companion chosen yet opens the companion pick
 * (the caller decides — `onChange(true)` with `hasCompanion` false). */
export function CompanionSwitch({ onChange, testID }: { onChange: (next: boolean) => void; testID: string }) {
  const { colors, companionShown } = useTheme();
  const flat = useFlatSurfaces();
  const { t } = useI18n();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, flat && flatRowStyle(colors.border)]}>
      <View style={styles.text}>
        <Text style={[type.rowTitle, { color: colors.ink }]}>{t('companionSwitch.title')}</Text>
        <Text style={[type.caption, { color: colors.inkMuted }]}>
          {companionShown ? t('companionSwitch.on') : t('companionSwitch.off')}
        </Text>
      </View>
      <Switch
        value={companionShown}
        onValueChange={onChange}
        trackColor={{ false: colors.dotIdle, true: colors.accent }}
        thumbColor="#FFFFFF"
        accessibilityLabel={t('companionSwitch.title')}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14 },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
