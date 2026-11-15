/**
 * SeekDots — five small dots lighting in turn, left to right (board A19): the quiet "we
 * are looking" signal between the two orbs. Opacity only. Under reduced motion they rest
 * as a still, fading row.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { dots } from '@/theme/motion';
import { radius, space } from '@/theme/tokens';
import { budgetRepeats, useMotionBudget } from '@/lib/motionBudget';

/** The still row (board's resting opacities) — what reduced motion shows. */
const REST = [0.9, 0.7, 0.5, 0.35, 0.25];

function Dot({ index, color }: { index: number; color: string }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(-1); // -1 = the still row
  // A bounded run of seeking (lib/motionBudget), then the still row; a new focus/arrival runs again.
  const budget = useMotionBudget();

  useEffect(() => {
    if (reduced || !budget.live) {
      cancelAnimation(p);
      p.value = -1;
      return;
    }
    p.value = 0;
    p.value = withSequence(
      withDelay(
        index * dots.seek.stagger,
        withRepeat(withTiming(1, { duration: dots.seek.period, easing: Easing.linear }), budgetRepeats(dots.seek.period, false), false)
      ),
      withTiming(-1, { duration: 0 })
    );
    return () => cancelAnimation(p);
  }, [reduced, index, p, budget.live, budget.run]);

  // Board keyframes: dim → lit at 20% → dim by 55%, then a rest.
  const style = useAnimatedStyle(() => ({
    opacity: reduced || p.value < 0 ? REST[index] : interpolate(p.value, [0, 0.2, 0.55, 1], [0.25, 1, 0.25, 0.25]),
  }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

export function SeekDots({ color }: { color: string }) {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {REST.map((_, i) => (
        <Dot key={i} index={i} color={color} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
});
