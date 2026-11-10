import { StyleSheet, Switch, Text, View } from 'react-native';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** "Show message text" in notifications, like a chat app. Off by default; the same row on the member and mentor Profile. */
export function PushStyleSwitch({ value, onChange, disabled = false, testID }: { value: boolean; onChange: (next: boolean) => void; disabled?: boolean; testID: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.text}>
        <Text style={[type.rowTitle, { color: colors.ink }]}>{t('pushStyle.title')}</Text>
        <Text style={[type.caption, { color: colors.inkMuted }]}>{value ? t('pushStyle.on') : t('pushStyle.off')}</Text>
        {value ? <Text style={[type.caption, { color: colors.inkMuted }]}>{t('pushStyle.note')}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.dotIdle, true: colors.accent }}
        thumbColor="#FFFFFF"
        accessibilityLabel={t('pushStyle.title')}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14 },
  text: { flex: 1, minWidth: 0, gap: 2 },
});
