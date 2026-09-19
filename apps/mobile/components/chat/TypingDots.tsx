/** "Steady Cedar is typing…" — board A05: three small dots rising in turn inside a little
 * white pillow pill, with the words beside it. The dot rhythm is the shared one
 * (components/motion/TypingDots — transform + opacity only, still under reduced motion). */
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { TypingDots as Dots } from '@/components/motion/TypingDots';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

export function TypingDots({ testID, label }: { testID?: string; label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.row} testID={testID} accessible accessibilityLabel={label ?? 'typing'}>
      <EdgeSurface
        edge={colors.edgeSurface}
        travel={2}
        radius={radius.pill}
        style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Dots color={colors.inkMuted} size={6} />
      </EdgeSurface>
      {label ? <Text style={[type.caption, { color: colors.inkMuted }]}>{label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginBottom: space.sm,
  },
  pill: { height: 28, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});
