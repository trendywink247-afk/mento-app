import { StyleSheet, Text } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Standing safety rail shown above the composer in every mentor-side chat: a
 * "not a therapist" reminder (T&S #2) plus one tap each into the helplines
 * sheet and the report flow — always in reach, never buried in a menu. */
export function MentorRail({
  onHelplines,
  onReport,
}: {
  onHelplines: () => void;
  onReport: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <EdgeSurface
      edge={colors.edgeAlt}
      radius={radius.md}
      style={[styles.face, { backgroundColor: colors.surfaceAlt }]}
      containerStyle={{ marginHorizontal: space.md, marginBottom: space.xs }}
      testID="mentor-rail"
    >
      <Text style={[type.caption, styles.caption, { color: colors.inkMuted }]} numberOfLines={2}>
        {t('mentor.chat.notTherapist')}
      </Text>
      <PressKey
        onPress={onHelplines}
        edge={colors.edgeSurface}
        travel={3}
        radius={radius.pill}
        style={[styles.pill, { backgroundColor: colors.surface }]}
        testID="mentor-helplines"
      >
        <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.helplines')}</Text>
      </PressKey>
      <PressKey
        onPress={onReport}
        edge={colors.edgeSurface}
        travel={3}
        radius={radius.pill}
        style={[styles.pill, { backgroundColor: colors.surface }]}
        testID="mentor-report"
      >
        <Text style={[type.label, { color: colors.danger }]}>{t('mentor.chat.report')}</Text>
      </PressKey>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  face: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
  },
  caption: { flex: 1 },
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
});
