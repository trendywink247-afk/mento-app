import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** One pending "stay in touch" ask as a pillow row (board A36 / A10): the link badge,
 * "<persona> asked to stay in touch", "Yes or not now. Decide when you are ready." */
export function StayInTouchRow({ id, name, onPress }: { id: string; name: string; onPress: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <PressKey
      onPress={onPress}
      edge={colors.edgeSurface}
      travel={4}
      radius={radius.md}
      intent="navigate"
      testID={`mentor-intouch-${id}`}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <IconBadge icon="link-outline" tone="accent" size={40} />
      <View style={styles.text}>
        <Text style={[type.rowTitle, { color: colors.ink }]}>{t('mentorHomePage.askTitle', { name })}</Text>
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorHomePage.askBody')}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
    </PressKey>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: space.sm,
    paddingLeft: 14,
    paddingRight: 12,
    borderWidth: 1,
  },
  text: { flex: 1, minWidth: 0 },
});
