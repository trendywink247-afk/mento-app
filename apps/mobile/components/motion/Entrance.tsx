/**
 * Entrance — fade + gentle rise on mount, staggered by sibling index.
 *
 * Implemented with manual shared values, NOT Reanimated's `entering=` layout
 * animations — those are unreliable on react-native-web, and web is our test
 * surface. Manual withDelay/withTiming behaves identically on both platforms.
 */
import { ReactNode, useEffect } from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { useReducedMotion } from '@/lib/useReducedMotion';
import { duration, easing, stagger } from '@/theme/motion';

type Props = {
  children: ReactNode;
  /** Sibling order — entrance is delayed by index * stagger.unit ms. */
  index?: number;
  /** Direction the content travels from. 'up' = rises from below (the default). */
  from?: 'up' | 'down' | 'none';
  distance?: number;
  style?: StyleProp<ViewStyle>;
};

export function Entrance({ children, index = 0, from = 'up', distance = 16, style }: Props) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = reduced
      ? withTiming(1, { duration: 150 })
      : withDelay(
          index * stagger.unit,
          withTiming(1, { duration: duration.gentle, easing: easing.enter })
        );
    // reason: an entrance plays exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const offset = from === 'none' ? 0 : from === 'up' ? distance : -distance;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : offset * (1 - progress.value) }],
  }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}
