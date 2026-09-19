/**
 * DeepArrival — a deeper page's content column comes in from the side once (board
 * FINAL_SPEC "arrDeep": 48px, fade, 500 ms settle), then its inner blocks rise with
 * `Entrance`. The back key is NOT wrapped: it is simply already there.
 *
 * Native: the stack already pushes the whole page in from the right
 * (`animation: 'slide_from_right'`), so there the column only fades — a second sideways
 * move on top of the push would read as a stutter. Web has no stack animation, so the
 * column carries the move itself. Reduced motion: a short fade, nothing moves.
 */
import { ReactNode, useEffect } from 'react';
import { Platform, StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, press, sheet } from '@/theme/motion';

export function DeepArrival({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(0);
  const shift = Platform.OS === 'web' ? sheet.deepShift : 0;

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
