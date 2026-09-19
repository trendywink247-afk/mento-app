/**
 * AllowanceMeter — the little battery of pips (boards A05 / A21 / A22): one pip per message
 * of the day, lit in the member's accent while it is still theirs to send.
 *
 * Idle motion (A05 only, `alive`): the LAST lit pip breathes — opacity only, at the
 * breathing tempo. Inside the three-in-a-row note it is drawn still (limit states never
 * move, T&S #11), and reduced motion stills it everywhere.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';

const MAX_PIPS = 20; // a misconfigured limit never draws a bar wider than the row

function BreathingPip({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const dim = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      cancelAnimation(dim);
      dim.value = 0;
      return;
    }
    dim.value = withRepeat(withTiming(1, { duration: breathe.period, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(dim);
  }, [reduced, dim]);
  const style = useAnimatedStyle(() => ({ opacity: 1 - 0.5 * dim.value }));
  return <Animated.View style={[styles.pip, { backgroundColor: color }, style]} />;
}

export function AllowanceMeter({
  left,
  limit,
  alive = false,
  onNote = false,
  accessibilityLabel,
}: {
  left: number;
  limit: number;
  /** The last lit pip breathes. Off inside the note and in any still state. */
  alive?: boolean;
  /** Drawn on the note's warm card: the battery's well is white instead of warm. */
  onNote?: boolean;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const pips = Math.max(1, Math.min(limit, MAX_PIPS));
  const lit = Math.max(0, Math.min(left, pips));
  return (
    <View
      style={styles.meter}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID="allowance-meter"
    >
      <View
        style={[
          styles.well,
          { backgroundColor: onNote ? colors.surface : colors.surfaceAlt, borderColor: colors.dotIdle },
        ]}
      >
        {Array.from({ length: pips }, (_, i) =>
          i < lit ? (
            alive && i === lit - 1 ? (
              <BreathingPip key={i} color={colors.accent} />
            ) : (
              <View key={i} style={[styles.pip, { backgroundColor: colors.accent }]} />
            )
          ) : (
            <View key={i} style={[styles.pip, { backgroundColor: colors.edgeSurface }]} />
          ),
        )}
      </View>
      <View style={[styles.cap, { backgroundColor: colors.dotIdle }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  meter: { flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 },
  well: { flexDirection: 'row', gap: 3, padding: 3, borderWidth: 1.5, borderRadius: 7 },
  pip: { width: 8, height: 12, borderRadius: 3 },
  cap: { width: 3, height: 8, borderTopRightRadius: 2, borderBottomRightRadius: 2 },
});
