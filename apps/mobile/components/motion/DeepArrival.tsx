/**
 * DeepArrival — a deeper page's content column comes in from the side once (board
 * FINAL_SPEC "arrDeep": 48px, fade, 500 ms settle), then its inner blocks rise with
 * `Entrance`. The back key is NOT wrapped: it is simply already there.
 *
 * The page itself only crossfades over the one sky (native) or cuts (web), so the column
 * carries the sideways move on both. Reduced motion: a short fade, nothing moves.
 */
import { ReactNode, useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, press, sheet } from '@/theme/motion';

export function DeepArrival({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  // The root stack crossfades pages over the one sky (app/_layout.tsx), so on every
  // platform the column itself carries the move in from the side.
  const shift = sheet.deepShift;

  useEffect(() => {
    p.value = reduced
      ? withTiming(1, { duration: press.reduced })
      : withTiming(1, { duration: duration.gentle, easing: easing.settle });
    // reason: an arrival plays exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animated = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateX: reduced ? 0 : shift * (1 - p.value) }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
