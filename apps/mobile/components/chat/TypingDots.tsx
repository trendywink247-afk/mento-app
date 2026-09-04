/** Three dots breathing on a bubble — the "someone is typing" presence. Transform +
 * opacity only, staggered on the shared breathe tempo; frozen under reduced motion. */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const PERIOD = breathe.period / 4; // 1300 ms per dot cycle

function Dot({ index, reduced }: { index: number; reduced: boolean }) {
  const { colors } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    if (reduced) {
      v.value = 0;
      return;
    }
    v.value = withDelay(
      index * (PERIOD / 6),
      withRepeat(
        withSequence(
          withTiming(1, { duration: PERIOD / 2, easing: easing.breathe }),
          withTiming(0, { duration: PERIOD / 2, easing: easing.breathe }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(v);
  }, [index, reduced, v]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: -3 * v.value }],
    opacity: 0.45 + 0.55 * v.value,
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: colors.accent }, style]} />;
}

export function TypingDots({ testID }: { testID?: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      travel={3}
      radius={radius.lg}
      faceRadiusStyle={{ borderBottomLeftRadius: radius.sm }}
      style={[styles.bubble, { backgroundColor: colors.surface }]}
      containerStyle={styles.wrap}
      testID={testID}
    >
      <View style={styles.row} accessibilityLabel="typing">
        {[0, 1, 2].map((i) => (
          <Dot key={i} index={i} reduced={reduced} />
        ))}
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'flex-start', marginHorizontal: space.md, marginTop: space.xs },
  bubble: { paddingHorizontal: space.md, paddingVertical: space.sm + 2 },
  row: { flexDirection: 'row', gap: 5, alignItems: 'center', height: 14 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
