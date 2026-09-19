/**
 * TypingDots — three small dots rising in turn (the "someone is writing" beat in the
 * landing's reply card). Transform + opacity only; under reduced motion the dots sit
 * still at rest strength.
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
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { dots } from '@/theme/motion';

function Dot({ index, color, size }: { index: number; color: string; size: number }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(p);
      p.value = 0;
      return;
    }
    p.value = withDelay(
      index * dots.typing.stagger,
      withRepeat(withTiming(1, { duration: dots.typing.period, easing: Easing.linear }), -1, false)
    );
    return () => cancelAnimation(p);
  }, [reduced, index, p]);

  // Board keyframes: rest → up at 30% → rest by 60%, then a pause.
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(p.value, [0, 0.3, 0.6, 1], [0.35, 1, 0.35, 0.35]),
    transform: [{ translateY: interpolate(p.value, [0, 0.3, 0.6, 1], [0, -dots.typing.rise, 0, 0]) }],
  }));

  return <Animated.View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }, style]} />;
}

export function TypingDots({ color, size = 6 }: { color: string; size?: number }) {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Dot index={0} color={color} size={size} />
      <Dot index={1} color={color} size={size} />
      <Dot index={2} color={color} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 8 },
});
