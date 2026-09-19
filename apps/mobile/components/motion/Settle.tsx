/**
 * Settle — lands a small thing softly, once, on mount (board `settle`): a slight scale-up,
 * a few px of rise and a fade. The "Save to Mentor Notes" key and the "Saved" chip use it.
 * Transform + opacity only, manual shared value; under reduced motion (or with `play`
 * false) the child is simply there.
 */
import { ReactNode, useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { chat, duration, easing } from '@/theme/motion';

export function Settle({
  play = true,
  delay = 0,
  style,
  children,
}: {
  play?: boolean;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();
  const p = useSharedValue(play && !reduced ? 0 : 1);
  useEffect(() => {
    if (p.value === 1) return;
    p.value = reduced
      ? 1
      : withDelay(delay, withTiming(1, { duration: duration.gentle, easing: easing.settle }));
    // reason: a settle plays exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const animated = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [
      { translateY: chat.settle.rise * (1 - p.value) },
      { scale: chat.settle.from + (1 - chat.settle.from) * p.value },
    ],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
